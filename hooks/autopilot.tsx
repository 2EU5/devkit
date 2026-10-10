import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRow, IssueResult, Run, Size, StepEntry, Work } from '../types'

// Live view of an /autopilot run: a bordered band above the prompt, toasts, and the
// skill's rule 12 cap (max 3 concurrent subagents) enforced at spawn.

const TOOL = 'mcp__devkit__status'
const MAX_AGENTS = 3
const PHASES = ['plan', 'code', 'verify', 'commit'] as const
const NO_WORK: Work = { tools: 0, files: [], commits: 0 }
// No status call for longer than the XL limit plus slack: the run died without run_end.
const STALE_MS = 4.5 * 60 * 60_000
const COMMIT = /\bgit\b(?:\s+-[Cc]\s+\S+|\s+--?[\w-]+(?:=\S+)?)*\s+commit\b/

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
  project?: string
}

// decide and audit may run their own subagents beyond the cap (skill rule 12).
export const isCapExempt = (s: string) => /^(decide|audit)/i.test(s)
export const isCommit = (command: string) => COMMIT.test(command)

const minutes = (from: number, to: number) => Math.max(0, Math.floor((to - from) / 60_000))
export const fmtTokens = (n: number) =>
  n < 1000 ? `${n}` : n < 1e6 ? `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}k` : `${(n / 1e6).toFixed(n < 1e7 ? 2 : 1)}M`
export const fmt = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`)

// Smooth bar with eighth-block tips: ratio 0..1 (clamped) over `width` cells.
export const bar = (ratio: number, width: number) => {
  const eighths = Math.round(Math.min(1, Math.max(0, ratio)) * width * 8)
  const full = Math.floor(eighths / 8)
  const tip = eighths % 8 ? '▏▎▍▌▋▊▉'[(eighths % 8) - 1] : ''
  return { filled: '█'.repeat(full) + tip, empty: '░'.repeat(width - full - (tip ? 1 : 0)) }
}

// Phase tracker: a step starting with a phase word enters that phase (going back too);
// every step's time counts toward the phase it is in.
export const phases = (list: StepEntry[], at: number) => {
  const spent: (number | undefined)[] = PHASES.map(() => undefined)
  let current = -1
  list.forEach((one, i) => {
    const hit = PHASES.findIndex(name => one.text.toLowerCase().startsWith(name))
    current = hit >= 0 ? hit : current
    if (current >= 0) spent[current] = (spent[current] ?? 0) + (list[i + 1]?.at ?? at) - one.at
  })
  return PHASES.map((name, i) => {
    const state = i < current ? 'done' : i === current ? 'now' : 'todo'
    const ms = spent[i]
    return { name, state, mins: ms === undefined ? undefined : Math.floor(ms / 60_000) } as const
  })
}

const endRun = async ($: EngineInterface, why: string) => {
  const list = await read($, results)
  const done = list.filter(one => one.isDone).length
  await update($, isRunning, () => false)
  await update($, issue, () => null)
  $.ui.toast(`Autopilot ${why}: ${done} done, ${list.length - done} need input`)
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
          project: { type: 'string', description: 'run_start: Linear project name' },
        },
        required: ['action'],
      },
      isDeferred: false,
    })
    // Redraws elapsed time during a run, and ends a run that went stale.
    $.clock.every(30_000, async () => {
      if (!(await read($, isRunning))) return
      const t = await $.clock.now()
      const r = await read($, run)
      if (r && t - r.lastAt > STALE_MS) return endRun($, 'stopped (no progress)')
      await update($, now, () => t)
    })

    return next(e)
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as StatusInput
    const at = await $.clock.now()
    await update($, now, () => at)
    const current = await read($, issue)
    const id = input.issue ?? current?.id ?? '?'
    // Any action may carry an updated total (sub-issues added mid-run).
    if (input.action !== 'run_start') {
      await update($, run, r => (r ? { ...r, lastAt: at, total: input.total ?? r.total } : r))
    }

    switch (input.action) {
      case 'run_start': {
        const cwd = input.project ? '' : await $.session.cwd().catch(() => '')
        const project = input.project || (cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? '')
        await update($, isRunning, () => true)
        await update($, run, () => ({ project, scope: input.text ?? '', startedAt: at, lastAt: at, total: input.total, tokens: 0 }) satisfies Run)
        await update($, issue, () => null)
        await update($, agents, list => list.filter(one => one.status === 'running'))
        await update($, steps, () => [])
        await update($, work, () => NO_WORK)
        await update($, results, () => [])
        break
      }
      case 'issue_start':
        await update($, issue, () => ({ id, title: input.title ?? '', size: input.size, startedAt: at }))
        await update($, steps, () => [])
        await update($, work, () => NO_WORK)
        break
      case 'step':
        await update($, steps, list => [...list, { text: input.text ?? '', at }].slice(-200))
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
      case 'run_end':
        await endRun($, 'finished')
        break
    }

    return { result: 'ok', text: 'ok' }
  })

  // Work stats for the current issue: tool calls, files touched, commits.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.tool !== TOOL && !ran.deny && (await read($, issue))) {
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
    if (!ran.deny && !ran.isError && isCommit(e.command) && (await read($, issue))) {
      await update($, work, w => ({ ...w, commits: w.commits + 1 }))
    }
    return ran
  })

  // Run token total: every model request, main loop and subagents. Cache reads are left out:
  // each step re-reads the whole context, which would swamp the figure.
  on('turn.step', async function* ($, e, next) {
    const response = yield* next(e)
    const u = response.usage
    if (u && (await read($, isRunning))) {
      const n = u.input_tokens + u.output_tokens + u.cache_creation_input_tokens
      await update($, run, r => (r ? { ...r, tokens: r.tokens + n } : r))
    }
    return response
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
      // Keep every running row (the cap counts them) and the last few finished ones.
      await update($, agents, list => {
        const all = [...list, row]
        return [...all.filter(one => one.status !== 'running').slice(-5), ...all.filter(one => one.status === 'running')]
      })
    }

    return spawned
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'autopilot: subagent cap check failed.' }))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) {
      const status: AgentRow['status'] = e.reason === 'answer' ? 'done' : 'failed'
      await update($, agents, list => list.map(one => (one.id === e.agentId ? { ...one, status } : one)))
    } else if (e.reason === 'aborted' && (await read($, isRunning))) {
      // The person stopped the main loop: the run will not reach run_end.
      await endRun($, 'stopped')
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
    const okCount = done.filter(one => one.isDone).length
    const project = runNow.project.length > 24 ? `${runNow.project.slice(0, 23)}…` : runNow.project
    const tail = runNow.total ? ` ${done.length}/${runNow.total} issues` : ''
    const tok = `${fmtTokens(runNow.tokens)} tok`
    const runTime = `run ${fmt(minutes(runNow.startedAt, at))}`
    const leftLen = '◆ AUTOPILOT'.length + (project ? 3 + project.length : 0) + (tail ? 3 + tail.length : 0)
    // Sized against a worst-case right side so the bar does not jitter as digits change.
    const rightLen = '✓ 99 ✗ 99 · 999k tok · run 9h59'.length
    // Border and padding take 4 cells, then a 2-cell gap and 1 cell of slack for wide glyphs.
    const fit = Math.min(30, e.props.bodyColumns - 4 - 3 - leftLen - rightLen)
    const width = fit >= 6 ? fit : 0
    const last = done.at(-1)
    // Fixed segments never shrink; only free text (project, title, scope, step, descriptions) truncates.
    const fixed = (...nodes: unknown[]) => <Box flexShrink={0}>{nodes}</Box>
    const sep = <Text color="subtle"> · </Text>
    const label = (t: string) => fixed(<Text color="subtle">{t.padEnd(10)}</Text>)
    const b = bar(runNow.total ? done.length / runNow.total : 0, width)

    const header = (
      <Box justifyContent="space-between">
        <Box flexShrink={1}>
          {fixed(<Text color="claude" bold>◆ AUTOPILOT</Text>)}
          {project ? <Text bold wrap="truncate-end">{'   '}{project}</Text> : null}
          {runNow.total
            ? fixed(
                <Text>{'   '}</Text>,
                width ? <Text color="claude">{b.filled}</Text> : null,
                width ? <Text color="subtle">{b.empty}</Text> : null,
                <Text>{tail}</Text>,
              )
            : fixed(<Text color="subtle" italic>{'   '}scoping…</Text>)}
        </Box>
        {fixed(
          <Text color={okCount ? 'success' : 'subtle'}>✓ {okCount}</Text>,
          <Text> </Text>,
          <Text color={done.length > okCount ? 'warning' : 'subtle'}>✗ {done.length - okCount}</Text>,
          sep,
          <Text color="subtle">{tok}</Text>,
          sep,
          <Text color="subtle">{runTime}</Text>,
        )}
      </Box>
    )

    // Short slot (fullscreen on a small terminal): drop the milestone row rather than scroll.
    const milestone =
      runNow.scope && !(e.props.maxRows < 7) ? (
        <Box>
          {label('milestone')}
          <Text bold wrap="truncate-end">{runNow.scope}</Text>
        </Box>
      ) : null

    const issueRow = current ? (
      <Box>
        {label('issue')}
        {fixed(<Text color="claude" bold>{current.id}</Text>, <Text color="subtle"> [{current.size ?? '?'}] </Text>)}
        <Text bold wrap="truncate-end">{current.title}</Text>
      </Box>
    ) : (
      <Box>
        {label('issue')}
        <Text color="subtle" italic wrap="truncate-end">… picking next issue</Text>
      </Box>
    )

    // Same row in both states, so the band keeps its height between issues.
    const stepNow = current ? list.at(-1)?.text ?? '' : ''
    const phaseRow = (
      <Box>
        {label('phase')}
        {fixed(
          ...phases(current ? list : [], at).map((one, i) => {
            const isSeen = one.state === 'todo' && one.mins !== undefined
            return (
              <Text key={one.name} color={one.state === 'done' ? 'success' : one.state === 'now' ? 'claude' : 'subtle'} bold={one.state === 'now'}>
                {i ? (one.state === 'todo' ? ' ── ' : ' ━━ ') : ''}
                {one.state === 'done' ? '●' : one.state === 'now' ? '◉' : isSeen ? '◌' : '○'} {one.name}
                {one.mins !== undefined ? ` ${fmt(one.mins)}` : ''}
              </Text>
            )
          }),
        )}
        {stepNow ? <Text color="subtle" italic wrap="truncate-end">{'   '}» {stepNow}</Text> : null}
      </Box>
    )

    const footer = (
      <Box>
        {fixed(<Text color={live.length >= MAX_AGENTS ? 'warning' : 'subtle'}>agents {live.length}/{MAX_AGENTS}</Text>)}
        {current ? fixed(<Text color="subtle">{'  │  '}{w.tools} tools · {w.files.length} files · {w.commits} commits</Text>) : null}
        {last
          ? fixed(
              <Text color={last.isDone ? 'success' : 'warning'}>
                {'  │  '}last {last.isDone ? '✓' : '✗'} {last.id} {fmt(last.minutes)}
              </Text>,
            )
          : null}
        {live.slice(0, 2).map(one => (
          <Text key={one.id} color="subtle" wrap="truncate-end">
            {'  │  '}▸ {one.description} {fmt(minutes(one.startedAt, at))}
          </Text>
        ))}
      </Box>
    )

    return (
      <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
        {header}
        {milestone}
        {issueRow}
        {phaseRow}
        {footer}
      </Box>
    )
  })
}
