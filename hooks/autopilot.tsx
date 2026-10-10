import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { AgentRow, Issue, LogEntry, Size } from '../types'

// Live view of an /autopilot run: a pane, a band above the prompt, toasts, and the
// skill's rule 12 cap (max 3 concurrent subagents) enforced at spawn.

const PANE = 'autopilot'
const TOOL = 'mcp__devkit__status'
const MAX_AGENTS = 3
const LIMIT_MIN: Record<Size, number> = { S: 15, M: 30, L: 60, XL: 120 }

const isRunning = atom({ plugin: 'devkit', key: 'isRunning' } as const, false)
const issue = atom({ plugin: 'devkit', key: 'issue' } as const, null)
const step = atom({ plugin: 'devkit', key: 'step' } as const, '')
const agents = atom({ plugin: 'devkit', key: 'agents' } as const, [])
const log = atom({ plugin: 'devkit', key: 'log' } as const, [])
const now = atom({ plugin: 'devkit', key: 'now' } as const, 0)

type StatusInput = {
  action: 'run_start' | 'issue_start' | 'step' | 'issue_done' | 'issue_abort' | 'run_end'
  issue?: string
  title?: string
  size?: Size
  text?: string
}

// decide and audit may run their own subagents beyond the cap (skill rule 12).
export const isCapExempt = (s: string) => /^(decide|audit)\b/i.test(s)

export const elapsed = (one: Issue, at: number) => {
  const limit = one.size ? LIMIT_MIN[one.size] : undefined
  const used = Math.max(0, Math.floor((at - one.startedAt) / 60_000))
  return { used, limit, isOver: limit !== undefined && used > limit }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'status',
      description:
        'Report /autopilot progress to the live autopilot pane. Call at run start, issue start, each step, issue done or abort, and run end.',
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
          text: { type: 'string', description: 'Step name, or what was done / why aborted' },
        },
        required: ['action'],
      },
      isDeferred: false,
    })
    await $.command.register({ name: 'autopilot-pane', description: 'Open the autopilot progress pane' })
    // Redraws elapsed time while nothing else changes.
    $.clock.every(30_000, () => void $.clock.now().then(t => update($, now, () => t)))

    return next(e)
  })

  on('command.run', { command: 'autopilot-pane' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Autopilot' })

    return { text: 'Autopilot pane opened.' }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as StatusInput
    const at = await $.clock.now()
    await update($, now, () => at)
    const addLog = (text: string) =>
      update($, log, list => [...list, { at, text } satisfies LogEntry].slice(-50))
    const current = await read($, issue)
    const id = input.issue ?? current?.id ?? '?'

    switch (input.action) {
      case 'run_start':
        await update($, isRunning, () => true)
        await update($, issue, () => null)
        await update($, agents, () => [])
        await update($, log, () => [])
        await addLog('run started')
        void $.ui.open({ id: PANE, title: 'Autopilot' }).catch(() => undefined)
        break
      case 'issue_start':
        await update($, issue, () => ({ id, title: input.title ?? '', size: input.size, startedAt: at }))
        await update($, step, () => '')
        await addLog(`▶ ${id} ${input.size ?? ''} ${input.title ?? ''}`.trim())
        break
      case 'step':
        await update($, step, () => input.text ?? '')
        break
      case 'issue_done':
      case 'issue_abort': {
        const isDone = input.action === 'issue_done'
        const text = `${isDone ? '✓' : '✗ Needs Input'} ${id}${input.text ? `: ${input.text}` : ''}`
        await addLog(text)
        $.ui.toast(text)
        await update($, issue, () => null)
        await update($, step, () => '')
        break
      }
      case 'run_end': {
        const entries = await read($, log)
        const done = entries.filter(one => one.text.startsWith('✓')).length
        const aborted = entries.filter(one => one.text.startsWith('✗')).length
        await addLog('run ended')
        await update($, isRunning, () => false)
        await update($, issue, () => null)
        $.ui.toast(`Autopilot finished: ${done} done, ${aborted} need input`)
        break
      }
    }

    return { result: 'ok', text: 'ok' }
  })

  // Rule 12 cap; only main-loop spawns during a run count.
  on('agent.spawn', async ($, e, next) => {
    if (e.parentAgentId || e.workflow || !(await read($, isRunning))) {
      return next(e)
    }
    const running = (await read($, agents)).filter(one => one.status === 'running').length
    if (running >= MAX_AGENTS && !isCapExempt(await read($, step))) {
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
    const current = await read($, issue)
    if (e.props.hasSurvey || !(await read($, isRunning))) {
      return next(e)
    }
    const { Text } = $.ui.resolve(e)
    const running = (await read($, agents)).filter(one => one.status === 'running').length
    if (!current) {
      return <Text dimColor>autopilot: picking next issue · {running} agents</Text>
    }
    const time = elapsed(current, await read($, now))
    const stepNow = await read($, step)

    return (
      <Text color={time.isOver ? 'red' : undefined} dimColor={!time.isOver}>
        ▶ {current.id} · {current.size ?? '?'} · {time.used}/{time.limit ?? '?'}m
        {stepNow ? ` · ${stepNow}` : ''} · {running} agents
      </Text>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const at = await read($, now)
    const current = await read($, issue)
    const stepNow = await read($, step)
    const rows = await read($, agents)
    const entries = await read($, log)
    const time = current ? elapsed(current, at) : null

    return (
      <Box flexDirection="column">
        <Text bold>{(await read($, isRunning)) ? 'Running' : 'Idle'}</Text>
        <Text bold>Issue</Text>
        {current && time ? (
          <Box flexDirection="column">
            <Text>
              {current.id} {current.title}
            </Text>
            <Text color={time.isOver ? 'red' : time.limit && time.used >= time.limit * 0.8 ? 'yellow' : undefined}>
              {current.size ?? '?'} · {time.used}/{time.limit ?? '?'} min{stepNow ? ` · ${stepNow}` : ''}
            </Text>
          </Box>
        ) : (
          <Text dimColor>None</Text>
        )}
        <Text bold>Subagents</Text>
        {rows.length === 0 && <Text dimColor>None</Text>}
        {rows.slice(-8).map(one => (
          <Text key={one.id} dimColor={one.status !== 'running'} color={one.status === 'failed' ? 'red' : undefined}>
            {one.status === 'running' ? `runs ${Math.floor((at - one.startedAt) / 60_000)}m` : one.status} {one.description}
          </Text>
        ))}
        <Text bold>Log</Text>
        {entries.length === 0 && <Text dimColor>Empty</Text>}
        {entries.slice(-10).map((one, i) => (
          <Text key={`${one.at}-${i}`} dimColor>
            {one.text}
          </Text>
        ))}
      </Box>
    )
  })
}
