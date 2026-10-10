import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { AgentRow, Issue, IssueResult, Run, Size, StepEntry, Work } from '../types'

// Live view of an /autopilot run: a bordered band above the prompt, toasts, and the
// skill's rule 12 cap (max 3 concurrent subagents) enforced at spawn.

const TOOL = 'mcp__devkit__status'
const MAX_AGENTS = 3
const LIMIT_MIN: Record<Size, number> = { S: 15, M: 30, L: 60, XL: 120 }
const PHASES = ['plan', 'code', 'verify', 'commit'] as const
const NO_WORK: Work = { tools: 0, files: [], commits: 0 }

const isRunning = atom({ plugin: 'devkit', key: 'isRunning' } as const, false)
const issue = atom({ plugin: 'devkit', key: 'issue' } as const, null)
const agents = atom({ plugin: 'devkit', key: 'agents' } as const, [])
const now = atom({ plugin: 'devkit', key: 'now' } as const, 0)
const run = atom({ plugin: 'devkit', key: 'run' } as const, null)
const steps = atom({ plugin: 'devkit', key: 'steps' } as const, [])
const work = atom({ plugin: 'devkit', key: 'work' } as const, NO_WORK)
const results = atom({ plugin: 'devkit', key: 'results' } as const, [])

type StatusInput = {
  action: 'run_start' | 'issue_start' | 'step' | 'issue_done' | 'issue_abort' | 'run_end'
  issue?: string
  title?: string
  size?: Size
  text?: string
  total?: number
}

// decide and audit may run their own subagents beyond the cap (skill rule 12).
export const isCapExempt = (s: string) => /^(decide|audit)\b/i.test(s)

export const elapsed = (one: Issue, at: number) => {
  const limit = one.size ? LIMIT_MIN[one.size] : undefined
  const used = minutes(one.startedAt, at)
  return { used, limit, isOver: limit !== undefined && used > limit }
}

const minutes = (from: number, to: number) => Math.max(0, Math.floor((to - from) / 60_000))
export const fmt = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`)

// Smooth bar with eighth-block tips: ratio 0..1 (clamped) over `width` cells.
export const bar = (ratio: number, width: number) => {
  const eighths = Math.round(Math.min(1, Math.max(0, ratio)) * width * 8)
  const full = Math.floor(eighths / 8)
  const tip = eighths % 8 ? '▏▎▍▌▋▊▉'[(eighths % 8) - 1] : ''
  return { filled: '█'.repeat(full) + tip, empty: '░'.repeat(width - full - (tip ? 1 : 0)) }
}

// Phase each step text opens (plan/code/verify/commit), with minutes spent in it.
export const phases = (list: StepEntry[], at: number) => {
  const starts = PHASES.map(name => list.find(one => one.text.toLowerCase().startsWith(name))?.at)
  const current = starts.reduce<number>((last, s, i) => (s === undefined ? last : i), -1)
  return PHASES.map((name, i) => {
    const start = starts[i]
    const end = starts.slice(i + 1).find(s => s !== undefined) ?? at
    const state = i < current ? 'done' : i === current ? 'now' : 'todo'
    return { name, state, mins: start === undefined ? undefined : minutes(start, end) } as const
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'status',
      description:
        'Report /autopilot progress to the live autopilot band. Call at run start, issue start, each step, issue done or abort, and run end.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['run_start', 'issue_start', 'step', 'issue_done', 'issue_abort', 'run_end'],
          },
          issue: { type: 'string', description: 'Linear issue ID, e.g. GAME-42' },
          title: { type: 'string' },
          size: { type: 'string', enum: ['S', 'M', 'L', 'XL'] },
          text: { type: 'string', description: 'run_start: scope (milestone). step: step name. done/abort: one-line reason' },
          total: { type: 'number', description: 'run_start: issues in scope' },
        },
        required: ['action'],
      },
      isDeferred: false,
    })
    // Redraws elapsed time while nothing else changes.
    $.clock.every(30_000, () => void $.clock.now().then(t => update($, now, () => t)))

    return next(e)
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as StatusInput
    const at = await $.clock.now()
    await update($, now, () => at)
    const current = await read($, issue)
    const id = input.issue ?? current?.id ?? '?'

    switch (input.action) {
      case 'run_start':
        await update($, isRunning, () => true)
        await update($, run, () => ({ scope: input.text ?? '', startedAt: at, total: input.total }) satisfies Run)
        await update($, issue, () => null)
        await update($, agents, () => [])
        await update($, steps, () => [])
        await update($, work, () => NO_WORK)
        await update($, results, () => [])
        break
      case 'issue_start':
        await update($, issue, () => ({ id, title: input.title ?? '', size: input.size, startedAt: at }))
        await update($, steps, () => [])
        await update($, work, () => NO_WORK)
        break
      case 'step':
        await update($, steps, list => [...list, { text: input.text ?? '', at }].slice(-30))
        break
      case 'issue_done':
      case 'issue_abort': {
        const isDone = input.action === 'issue_done'
        const row: IssueResult = { id, isDone, minutes: current ? minutes(current.startedAt, at) : 0, note: input.text ?? '' }
        await update($, results, list => [...list, row].slice(-50))
        $.ui.toast(`${isDone ? '✓' : '✗ Needs Input'} ${id}${row.note ? `: ${row.note}` : ''}`)
        await update($, issue, () => null)
        await update($, steps, () => [])
        break
      }
      case 'run_end': {
        const list = await read($, results)
        const done = list.filter(one => one.isDone).length
        await update($, isRunning, () => false)
        await update($, issue, () => null)
        $.ui.toast(`Autopilot finished: ${done} done, ${list.length - done} need input`)
        break
      }
    }

    return { result: 'ok', text: 'ok' }
  })

  // Work stats for the current issue: tool calls, files touched, commits.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.tool !== TOOL && (await read($, issue))) {
      await update($, work, w => ({ ...w, tools: w.tools + 1 }))
    }
    return ran
  })
  for (const tool of ['Edit', 'Write'] as const) {
    on('tool.call', { tool }, async ($, e, next) => {
      const ran = await next(e)
      if (!ran.deny && (await read($, issue))) {
        await update($, work, w => (w.files.includes(e.file_path) ? w : { ...w, files: [...w.files, e.file_path] }))
      }
      return ran
    })
  }
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (!ran.deny && !ran.isError && /\bgit\s+commit\b/.test(e.command) && (await read($, issue))) {
      await update($, work, w => ({ ...w, commits: w.commits + 1 }))
    }
    return ran
  })

  // Rule 12 cap; only main-loop spawns during a run count.
  on('agent.spawn', async ($, e, next) => {
    if (e.parentAgentId || e.workflow || !(await read($, isRunning))) {
      return next(e)
    }
    const running = (await read($, agents)).filter(one => one.status === 'running').length
    const stepNow = (await read($, steps)).at(-1)?.text ?? ''
    if (running >= MAX_AGENTS && !isCapExempt(stepNow)) {
      return { deny: `autopilot: ${MAX_AGENTS} subagents already running (rule 12). Wait for one to finish.` }
    }
    const spawned = await next(e)
    if (!('deny' in spawned && spawned.deny) && 'agentId' in spawned && spawned.agentId) {
      const row: AgentRow = { id: spawned.agentId, description: e.description, startedAt: await $.clock.now(), status: 'running' }
      await update($, agents, list => [...list, row].slice(-20))
    }

    return spawned
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'autopilot: subagent cap check failed.' }))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) {
      const status: AgentRow['status'] = e.reason === 'answer' ? 'done' : 'failed'
      await update($, agents, list => list.map(one => (one.id === e.agentId ? { ...one, status } : one)))
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const runNow = await read($, run)
    if (e.props.hasSurvey || !runNow || !(await read($, isRunning))) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)
    const at = await read($, now)
    const current = await read($, issue)
    const list = await read($, steps)
    const w = await read($, work)
    const done = await read($, results)
    const live = (await read($, agents)).filter(one => one.status === 'running')
    const width = Math.max(10, Math.min(30, e.props.bodyColumns - 40))
    const okCount = done.filter(one => one.isDone).length
    const last = done.at(-1)
    const sep = <Text color="subtle"> · </Text>
    const barRow = (p: { label: string; ratio: number; color: string; tail: string }) => {
      const b = bar(p.ratio, width)
      return (
        <Box>
          <Text color="subtle">{p.label.padEnd(6)}</Text>
          <Text color={p.color}>{b.filled}</Text>
          <Text color="subtle">{b.empty}</Text>
          <Text> {p.tail}</Text>
        </Box>
      )
    }

    const header = (
      <Box justifyContent="space-between">
        <Box>
          <Text color="claude" bold>◆ AUTOPILOT</Text>
          {runNow.scope ? <Text bold> {runNow.scope}</Text> : null}
        </Box>
        <Box>
          <Text color="success">✓ {okCount}</Text>
          <Text> </Text>
          <Text color={done.length > okCount ? 'warning' : 'subtle'}>✗ {done.length - okCount}</Text>
          {sep}
          <Text color="subtle">run {fmt(minutes(runNow.startedAt, at))}</Text>
        </Box>
      </Box>
    )

    const runBar = runNow.total ? (
      barRow({ label: 'run', ratio: done.length / runNow.total, color: 'claude', tail: `${done.length}/${runNow.total} issues` })
    ) : null

    const footer = (
      <Box>
        <Text color={live.length >= MAX_AGENTS ? 'warning' : 'subtle'}>⚙ {live.length}/{MAX_AGENTS} agents</Text>
        {live.slice(0, 2).map(one => (
          <Text key={one.id} color="subtle" wrap="truncate-end">
            {'  '}▸ {one.description} {fmt(minutes(one.startedAt, at))}
          </Text>
        ))}
        {current ? (
          <Text color="subtle">
            {'  │  '}{w.tools} tools · {w.files.length} files · {w.commits} commits
          </Text>
        ) : null}
        {last ? (
          <Text color={last.isDone ? 'success' : 'warning'} wrap="truncate-end">
            {'  │  '}last {last.isDone ? '✓' : '✗'} {last.id} {fmt(last.minutes)}
          </Text>
        ) : null}
      </Box>
    )

    if (!current) {
      return (
        <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
          {header}
          <Text color="subtle" italic>… picking next issue</Text>
          {runBar}
          {footer}
        </Box>
      )
    }

    const time = elapsed(current, at)
    const ratio = time.limit ? time.used / time.limit : 0
    const timeColor = time.isOver ? 'error' : ratio >= 0.8 ? 'warning' : 'success'
    const stepNow = list.at(-1)?.text ?? ''

    return (
      <Box flexDirection="column" borderStyle="round" borderColor={time.isOver ? 'error' : 'claude'} paddingX={1}>
        {header}
        <Box>
          <Text color="claude" bold>▶ {current.id}</Text>
          <Text color="subtle"> [{current.size ?? '?'}] </Text>
          <Text bold wrap="truncate-end">{current.title}</Text>
        </Box>
        <Box>
          <Text color="subtle">{'phase '.padEnd(6)}</Text>
          {phases(list, at).map((one, i) => (
            <Text key={one.name} color={one.state === 'done' ? 'success' : one.state === 'now' ? 'claude' : 'subtle'} bold={one.state === 'now'}>
              {i ? (one.state === 'todo' ? ' ── ' : ' ━━ ') : ''}
              {one.state === 'done' ? '●' : one.state === 'now' ? '◉' : '○'} {one.name}
              {one.mins !== undefined ? ` ${fmt(one.mins)}` : ''}
            </Text>
          ))}
          {stepNow ? <Text color="subtle" italic wrap="truncate-end">{'   '}» {stepNow}</Text> : null}
        </Box>
        {barRow({
          label: 'time',
          ratio,
          color: timeColor,
          tail: `${fmt(time.used)}/${time.limit ? fmt(time.limit) : '?'}${time.limit ? ` ${Math.round(ratio * 100)}%` : ''}${time.isOver ? ' over limit' : ''}`,
        })}
        {runBar}
        {footer}
      </Box>
    )
  })
}
