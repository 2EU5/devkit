import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRow, IssueResult, Run, Size, StepEntry, Work } from '../types'

// Live view of an /studio:ship run: a bordered band above the prompt, toasts, and the
// skill's rule 12 cap (max 5 concurrent subagents) enforced at spawn.

const TOOL = 'mcp__studio__status'
const MAX_AGENTS = 5
// The work phase is named per issue (its kind: code, ui, model, art, …). A step starting with
// the kind or any of these words enters it; without a kind it takes the first such word seen.
const WORK_WORDS = ['build', 'code', 'ui', 'model', 'art']
const DEFAULT_KIND = 'build'
const NO_WORK: Work = { tools: 0, files: [], commits: 0 }
// No status call for longer than the XL limit plus slack: the run died without run_end.
const STALE_MS = 4.5 * 60 * 60_000
const COMMIT = /\bgit\b(?:\s+-[Cc]\s+\S+|\s+--?[\w-]+(?:=\S+)?)*\s+commit\b/

const isRunning = atom({ plugin: 'studio', key: 'isRunning' } as const, false)
const issue = atom({ plugin: 'studio', key: 'issue' } as const, null)
const agents = atom({ plugin: 'studio', key: 'agents' } as const, [])
const now = atom({ plugin: 'studio', key: 'now' } as const, 0)
const run = atom({ plugin: 'studio', key: 'run' } as const, null)
const steps = atom({ plugin: 'studio', key: 'steps' } as const, [])
const work = atom({ plugin: 'studio', key: 'work' } as const, NO_WORK)
const results = atom({ plugin: 'studio', key: 'results' } as const, [])

type StatusInput = {
  action: 'run_start' | 'issue_start' | 'step' | 'issue_done' | 'issue_abort' | 'run_end'
  issue?: string
  title?: string
  size?: Size
  kind?: string
  text?: string
  total?: number
  project?: string
}

// council, audit and code-review (reported as audit) may run their own subagents beyond the cap (skill rule 12).
export const isCapExempt = (s: string) => /^(council|audit)/i.test(s)
export const isCommit = (command: string) => COMMIT.test(command)
// Rule 12: subagents run no git and no Unity tools (MCP or the `unity` CLI) during a run. A command
// counts at the start of any command in the line, after optional VAR=value prefixes; `command` is
// set for shell tools only. shortcut: a search pattern ending in `|git ` is refused too; rare, costs one call.
export const isSubagentBanned = (tool: string, command = '') =>
  /(?:^|_)unity/i.test(tool) || /(?:^|[;&|(\n])\s*(?:\w+=\S*\s+)*(?:git|unity)\b/.test(command)
// A step starts with a phase word as a whole word: "plan" yes, "planet" no.
const startsWord = (text: string, word: string) => text === word || new RegExp(`^${word}\\b`).test(text)

export const fmtTokens = (n: number) =>
  n < 1000 ? `${n}` : n < 1e6 ? `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}k` : `${(n / 1e6).toFixed(n < 1e7 ? 2 : 1)}M`

// Elapsed time, one format for every timer on the band: 48s, 4m 12s, 1h 04m.
export const dur = (ms: number) => {
  const s = Math.floor(Math.max(0, ms) / 1000) || 0
  const m = Math.floor(s / 60)
  if (m < 1) return `${s}s`
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

// The issue's kind as one short lowercase word ("UI" -> "ui"), or undefined.
export const toKind = (s?: string) =>
  s?.trim().toLowerCase().split(/\s+/)[0]?.replace(/[^a-z0-9-]/g, '').slice(0, 10) || undefined

// "M2.5 · Organic world" -> ['M2.5', 'Organic world'], so a short id can be drawn dim.
export const splitScope = (scope: string): readonly [string, string] => {
  const hit = /^(\S+?)(?:\s+[·—–-]|:)\s+(.+)$/.exec(scope)
  return hit?.[1] && hit[2] && hit[1].length <= 12 ? [hit[1], hit[2]] : ['', scope]
}

// Smooth bar with eighth-block tips: ratio 0..1 (clamped) over `width` cells.
export const bar = (ratio: number, width: number) => {
  const eighths = Math.round(Math.min(1, Math.max(0, ratio)) * width * 8)
  const full = Math.floor(eighths / 8)
  const tip = eighths % 8 ? '▏▎▍▌▋▊▉'[(eighths % 8) - 1] : ''
  return { filled: '█'.repeat(full) + tip, empty: '░'.repeat(width - full - (tip ? 1 : 0)) }
}

// Phase tracker: plan, the issue's kind, verify, commit. A step starting with a phase word
// enters that phase (going back too); other steps (council, audit, …) stay where they are.
// A phase left behind by going back is `seen`.
export const phases = (list: StepEntry[], kind?: string) => {
  const texts = list.map(one => one.text.trim().toLowerCase())
  const firstWork = texts.map(text => WORK_WORDS.find(word => startsWord(text, word))).find(Boolean)
  const label = kind || firstWork || DEFAULT_KIND
  const work = [label, ...WORK_WORDS]
  const seen = new Set<number>()
  let current = -1
  for (const text of texts) {
    // plan, verify and commit win over the work words, whatever the kind is.
    const named = ['plan', '', 'verify', 'commit'].findIndex(word => word && startsWord(text, word))
    const hit = named >= 0 ? named : work.some(word => startsWord(text, word)) ? 1 : -1
    if (hit >= 0) {
      current = hit
      seen.add(hit)
    }
  }
  return ['plan', label, 'verify', 'commit'].map((name, i) => {
    const state = i < current ? 'done' : i === current ? 'now' : seen.has(i) ? 'seen' : 'todo'
    return { name, state } as const
  })
}

const GLYPH = { done: '✓', now: '●', seen: '◌', todo: '○' } as const
const TONE = { done: 'success', now: 'claude', seen: 'subtle', todo: 'subtle' } as const

const endRun = async ($: EngineInterface, why: string) => {
  const list = await read($, results)
  const done = list.filter(one => one.isDone).length
  await update($, isRunning, () => false)
  await update($, issue, () => null)
  $.ui.toast(`Ship ${why}: ${done} done, ${list.length - done} need input`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'status',
      description:
        'Report /studio:ship progress to the live ship band. Call at run start, issue start, each step, issue done or abort, and run end.',
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
          kind: { type: 'string', description: 'issue_start: one word naming the work phase: code, ui, model, art, or another' },
          text: {
            type: 'string',
            description:
              'run_start, issue_start: scope (milestone, e.g. "M2.5 · Organic world"); issue_start only when the milestone changes. step: short text starting with the phase word (plan, the issue kind, verify, commit). done/abort: one-line reason',
          },
          total: { type: 'number', description: 'any action: issues in scope (updated as sub-issues are added)' },
          project: { type: 'string', description: 'run_start: Linear project name' },
        },
        required: ['action'],
      },
      isDeferred: false,
    })
    // Ticks the band's timers each second during a run, and ends a run that went stale.
    $.clock.every(1000, async () => {
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
    // Any action may carry an updated total (sub-issues added mid-run); issue_start a new milestone.
    if (input.action !== 'run_start') {
      const scope = input.action === 'issue_start' ? input.text : undefined
      await update($, run, r => (r ? { ...r, lastAt: at, total: input.total ?? r.total, scope: scope || r.scope } : r))
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
        await update($, issue, () => ({ id, title: input.title ?? '', size: input.size, kind: toKind(input.kind), startedAt: at }))
        await update($, steps, () => [])
        await update($, work, () => NO_WORK)
        break
      case 'step':
        await update($, steps, list => [...list, { text: input.text ?? '', at }].slice(-200))
        break
      case 'issue_done':
      case 'issue_abort': {
        const isDone = input.action === 'issue_done'
        const row: IssueResult = { id, isDone, ms: current ? Math.max(0, at - current.startedAt) : 0, note: input.text ?? '' }
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

  // Rule 12 guard for subagents, then work stats for the current issue: tool calls, files, commits.
  on('tool.call', async ($, e, next) => {
    const command = e.tool === 'Bash' || e.tool === 'PowerShell' ? e.command : ''
    if (e.agentId && isSubagentBanned(e.tool, command) && (await read($, isRunning))) {
      return { deny: 'ship: subagents run no git and no Unity tools (rule 12). Leave it to the main agent.' }
    }
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
  for (const tool of ['Bash', 'PowerShell'] as const) {
    on('tool.call', { tool }, async ($, e, next) => {
      const ran = await next(e)
      if (!ran.deny && !ran.isError && isCommit(e.command) && (await read($, issue))) {
        await update($, work, w => ({ ...w, commits: w.commits + 1 }))
      }
      return ran
    })
  }

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
      return { deny: `ship: ${MAX_AGENTS} subagents already running (rule 12). Wait for one to finish.` }
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
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'ship: subagent cap check failed.' }))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) {
      const status: AgentRow['status'] = e.reason === 'answer' ? 'done' : 'failed'
      await update($, agents, list => list.map(one => (one.id === e.agentId ? { ...one, status } : one)))
    } else if (e.reason !== 'answer' && (await read($, isRunning))) {
      // Stopped or failed: run_end will not come. An answer may only be a wait for background agents.
      await endRun($, e.reason === 'aborted' ? 'stopped' : 'failed')
    }

    return next(e)
  })

  // The band on an 80-column terminal:
  // ╭─────────────────────────────────────────────────────────────────────────╮
  // │ ◆ SHIP · Project Cell                                   run 4m 18s │
  // │ M2.5 Organic world                           ███▉░░░░░░░░░░ 3/11  ✓3 ✗0 │
  // │ ─────────────────────────────────────────────────────────────────────── │
  // │ ▶ TEC-91 [M] Cell inspector panel with live gene readout                │
  // │   ✓ plan ── ● ui ── ○ verify ── ○ commit   » ui wire gen…  issue 1m 48s │
  // │ ─────────────────────────────────────────────────────────────────────── │
  // │ agents 2/5 · tools 9 · files 3 · commits 1 · last ✓ TEC-90 50s  22k tok │
  // ╰─────────────────────────────────────────────────────────────────────────╯
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
    const badCount = done.length - okCount
    const last = done.at(-1)
    const total = runNow.total
    // Border and padding take 4 cells.
    const inner = e.props.bodyColumns - 4
    // Full height is 9 rows. A short slot (fullscreen on a small terminal) drops the rules,
    // then the footer, rather than scroll.
    const hasRules = !(e.props.maxRows < 9)
    const hasFooter = !(e.props.maxRows < 7)
    // Fixed segments never shrink; only free text (project, scope, title, step) truncates.
    const fixed = (...nodes: unknown[]) => <Box flexShrink={0}>{nodes}</Box>
    // Dim label, plain value: both timers, right-aligned.
    const stat = (label: string, value: string) => fixed(<Text color="subtle">{'  '}{label} </Text>, <Text>{value}</Text>)
    const rule = () => (hasRules ? <Text color="subtle" wrap="truncate-end">{'─'.repeat(Math.max(0, inner))}</Text> : null)

    const header = (
      <Box justifyContent="space-between">
        <Box flexShrink={1}>
          {fixed(<Text color="claude" bold>◆ SHIP</Text>, runNow.project ? <Text color="subtle"> · </Text> : null)}
          {runNow.project ? <Text bold wrap="truncate-end">{runNow.project}</Text> : null}
        </Box>
        {stat('run', dur(at - runNow.startedAt))}
      </Box>
    )

    // Sized against worst-case counts so the bar does not jitter as digits change; the scope
    // keeps up to 24 cells before the bar gives way. 2-cell gap plus 1 cell of slack for wide glyphs.
    const [scopeId, scopeName] = splitScope(runNow.scope)
    const countsLen = (total ? ` ${total}/${total}`.length : 'scoping…'.length) + `  ✓${total ?? 99} ✗${total ?? 99}`.length
    const fit = Math.min(14, inner - 3 - Math.min(runNow.scope.length, 24) - countsLen)
    const width = total && fit >= 6 ? fit : 0
    const b = bar(total ? done.length / total : 0, width)
    const milestone = (
      <Box justifyContent="space-between">
        <Box flexShrink={1}>
          {scopeId ? fixed(<Text color="subtle">{scopeId} </Text>) : null}
          <Text wrap="truncate-end">{scopeName}</Text>
        </Box>
        {fixed(
          <Text>{'  '}</Text>,
          b.filled ? <Text color="claude">{b.filled}</Text> : null,
          b.empty ? <Text color="subtle">{b.empty}</Text> : null,
          total ? <Text bold>{width ? ' ' : ''}{done.length}/{total}</Text> : <Text color="subtle" italic>scoping…</Text>,
          <Text color={okCount ? 'success' : 'subtle'}>{'  '}✓{okCount}</Text>,
          <Text color={badCount ? 'warning' : 'subtle'}> ✗{badCount}</Text>,
        )}
      </Box>
    )

    const issueRow = current ? (
      <Box>
        {fixed(<Text color="claude" bold>▶ {current.id}</Text>, <Text color="subtle"> [{current.size ?? '?'}] </Text>)}
        <Text wrap="truncate-end">{current.title}</Text>
      </Box>
    ) : (
      <Text color="subtle" italic wrap="truncate-end">… picking next issue</Text>
    )

    // Same row in both states, so the band keeps its height between issues. The stepper never
    // shrinks; on a narrow row the issue timer (sized for 59m 59s) gives way, then the step.
    const stages = phases(current ? list : [], current?.kind)
    const stepNow = current ? list.at(-1)?.text ?? '' : ''
    const stepperLen = 2 + stages.reduce((n, one, i) => n + (i ? 4 : 0) + 2 + one.name.length, 0)
    const issueTimeLen = '  issue 59m 59s'.length
    const hasIssueTime = !!current && inner >= stepperLen + issueTimeLen
    const hasStep = !!stepNow && inner - stepperLen - (hasIssueTime ? issueTimeLen : 0) >= 12
    const phaseRow = (
      <Box justifyContent="space-between">
        <Box flexShrink={1}>
          {fixed(
            <Text>{'  '}</Text>,
            ...stages.flatMap((one, i) => [
              i ? <Text key={`to${i}`} color="subtle"> ── </Text> : null,
              <Text key={`at${i}`} color={TONE[one.state]} bold={one.state === 'now'}>
                {GLYPH[one.state]} {one.name}
              </Text>,
            ]),
          )}
          {hasStep ? <Text color="subtle" italic wrap="truncate-end">{'   '}» {stepNow}</Text> : null}
        </Box>
        {current && hasIssueTime ? stat('issue', dur(at - current.startedAt)) : null}
      </Box>
    )

    // Stats, then the last result, show whole or not at all, so the footer never ends in a stub.
    const agentsText = `agents ${live.length}/${MAX_AGENTS}`
    const statsText = current ? ` · tools ${w.tools} · files ${w.files.length} · commits ${w.commits}` : ''
    const lastText = last ? ` · last ${last.isDone ? '✓' : '✗'} ${last.id} ${dur(last.ms)}` : ''
    const tokText = `  ${fmtTokens(runNow.tokens)} tok`
    const room = inner - agentsText.length - tokText.length
    const hasStats = statsText.length <= room
    const hasLast = lastText.length <= room - (hasStats ? statsText.length : 0)
    const footer = hasFooter ? (
      <Box justifyContent="space-between">
        {fixed(
          <Text color={live.length >= MAX_AGENTS ? 'warning' : live.length ? 'claude' : 'subtle'}>{agentsText}</Text>,
          statsText && hasStats ? <Text color="subtle">{statsText}</Text> : null,
          last && hasLast ? <Text color={last.isDone ? 'success' : 'warning'}>{lastText}</Text> : null,
        )}
        {fixed(<Text color="subtle">{tokText}</Text>)}
      </Box>
    ) : null

    return (
      <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
        {header}
        {milestone}
        {rule()}
        {issueRow}
        {phaseRow}
        {footer ? rule() : null}
        {footer}
      </Box>
    )
  })
}
