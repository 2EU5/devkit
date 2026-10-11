import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRow, AutoMark, IssueResult, Run, Size, StepEntry, Work } from '../types'

// Live view of an /studio:ship run: a bordered band above the prompt, toasts, and the
// skill's rule 12 cap (max 5 concurrent subagents) enforced at spawn.

const TOOL = 'mcp__studio__status'
const MAX_AGENTS = 5
// A step starting with the issue's kind (code, ui, model, art, …) or any of these words enters work.
const WORK_WORDS = ['build', 'code', 'ui', 'model', 'art']
const NO_WORK: Work = { tools: 0, files: [], commits: 0 }
// No status call for longer than the XL limit plus slack: the run died without run_end.
const STALE_MS = 4.5 * 60 * 60_000
const TEST_RUN = /run_?tests?|tests?_?run/i
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
  auto?: boolean
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

// The run bar's blocks, one tone per issue in queue order: done, needs input, the one in
// progress, then the rest. Split: one block per issue, drawn with gaps; else neighbours of one
// tone merge into one block. A block's count is how many issues it stands for.
export type BarTone = 'ok' | 'bad' | 'now' | 'todo'
export const runBar = (done: readonly boolean[], hasCurrent: boolean, total: number, split: boolean) => {
  const n = Math.max(total, done.length + (hasCurrent ? 1 : 0))
  const blocks: { tone: BarTone; count: number }[] = []
  for (let i = 0; i < n; i++) {
    const tone: BarTone = i < done.length ? (done[i] ? 'ok' : 'bad') : i === done.length && hasCurrent ? 'now' : 'todo'
    const prev = blocks.at(-1)
    if (!split && prev?.tone === tone) prev.count++
    else blocks.push({ tone, count: 1 })
  }
  return blocks
}

// Phase tracker: plan, work, verify, commit. A reported step starting with a phase word enters
// that phase (going back too); the issue's kind and the work words enter work. Other steps
// (council, audit, …) stay where they are. Auto marks come from the work itself (an edit, a
// verify, a commit) and only move forward. A phase left behind by going back is `seen`.
export const PHASES = ['plan', 'work', 'verify', 'commit'] as const
export const phases = (list: readonly StepEntry[], kind?: string) => {
  const at: Record<AutoMark, number> = { plan: 0, work: 1, verify: 2, commit: 3 }
  const find = (text: string) => {
    const named = PHASES.findIndex(word => startsWord(text, word))
    if (named >= 0) return named
    return [kind, ...WORK_WORDS].some(word => word && startsWord(text, word)) ? 1 : -1
  }
  const seen = new Set<number>()
  let current = -1
  for (const one of list) {
    const hit = one.auto ? at[one.auto] : find(one.text.trim().toLowerCase())
    if (hit < 0 || (one.auto && hit <= current)) continue
    current = hit
    seen.add(hit)
  }
  return PHASES.map((name, i) => {
    const state = i < current ? 'done' : i === current ? 'now' : seen.has(i) ? 'seen' : 'todo'
    return { name, state } as const
  })
}

// The step text without the phase word it starts with: "verify: tests" -> "tests", "verify" -> "".
export const stepDetail = (text: string, phase?: string) =>
  phase && startsWord(text.toLowerCase(), phase) ? text.slice(phase.length).replace(/^[\s:—–-]+/, '') : text

// Reached (finished green, in progress in the accent) or not started; a phase left behind by
// going back is not started again.
const GLYPH = { done: '◉', now: '◉', seen: '○', todo: '○' } as const
const TONE = { done: 'success', now: 'claude', seen: 'subtle', todo: 'subtle' } as const

// An auto mark, unless the newest entry already is the same mark.
const mark = async ($: EngineInterface, auto: AutoMark) => {
  const at = await $.clock.now()
  await update($, steps, list => (list.at(-1)?.auto === auto ? list : [...list, { text: '', at, auto }].slice(-200)))
}

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
              'run_start, issue_start: scope (milestone, e.g. "M2.5 · Organic world"); issue_start only when the milestone changes. step: short text starting with the phase word (plan, the issue kind or work, verify, commit). done/abort: one-line reason',
          },
          total: { type: 'number', description: 'any action: issues in scope (updated as sub-issues are added)' },
          project: { type: 'string', description: 'run_start: Linear project name' },
          auto: { type: 'boolean', description: 'run_start: true in auto mode (/studio:ship auto), false when attended' },
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
        await update($, run, () => ({ project, scope: input.text ?? '', startedAt: at, lastAt: at, total: input.total, tokens: 0, isAuto: input.auto === true }) satisfies Run)
        await update($, issue, () => null)
        await update($, agents, list => list.filter(one => one.status === 'running'))
        await update($, steps, () => [])
        await update($, work, () => NO_WORK)
        await update($, results, () => [])
        break
      }
      case 'issue_start':
        await update($, issue, () => ({ id, title: input.title ?? '', size: input.size, kind: toKind(input.kind), startedAt: at }))
        await update($, steps, () => [{ text: '', at, auto: 'plan' }])
        await update($, work, () => NO_WORK)
        break
      case 'step':
        if (input.text) await update($, steps, list => [...list, { text: input.text ?? '', at }].slice(-200))
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
      const isVerify = (e.tool === 'Skill' && /(^|:)verify$/.test(e.skill)) || TEST_RUN.test(e.tool)
      const isEdit = e.tool === 'Edit' || e.tool === 'Write' || e.tool === 'NotebookEdit'
      if (!ran.isError && (isVerify || isEdit)) await mark($, isVerify ? 'verify' : 'work')
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
        await mark($, 'commit')
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
    const stepNow = (await read($, steps)).findLast(one => !one.auto)?.text ?? ''
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

  // The band on an 80-column terminal, in Claude Code's own accent so it sits with the rest of the
  // interface in any theme; the border is the prompt box's own grey. Auto mode is the one purple thing, as Claude Code marks its own.
  // Widths come from the layout, not from counting characters: the desktop draws a proportional
  // font, so a row sized in cells there overflows. Only what may give way shrinks.
  // ╭────────────────────────────────────────────────────────────────────────────╮
  // │  Project Cell: [M2.5] Organic world     auto on   run 4m 18s  •  4 / 12  ✓ 3  ✗ 0 │
  // │  ━━━━━ ━━━━━ ━━━━━ ━━━━━ ━━━━━ ━━━━━ ━━━━━ ━━━━━ ━━━━━ ━━━━━ ━━━━━ ━━━━━ │
  // │  TEC-91  [M]  Cell inspector panel with live gene readout    issue 1m 48s  │
  // │     ◉ plan ━━ ◉ work ── ○ verify ── ○ commit                               │
  // │     » ui wire gene readout                                                 │
  // │                                                                            │
  // │  agents 2/5   tools 9   files 3   commits 1   last ✓ TEC-90 50s   22k tok  │
  // ╰────────────────────────────────────────────────────────────────────────────╯
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
    const tint = 'claude'
    // Border and padding take 6 cells. An estimate on the desktop, used only to choose what shows.
    const inner = e.props.bodyColumns - 6
    // The reported step, less the phase word it starts with; its row shows only when it says more.
    const stages = phases(current ? list : [], current?.kind)
    const stepNow = current ? list.findLast(one => !one.auto)?.text.trim() ?? '' : ''
    const detail = stepDetail(stepNow, stages.find(one => one.state === 'now')?.name)
    // Full height is 8 rows, 9 with the step row. A short slot (fullscreen on a small terminal)
    // drops the blank row, then the footer, rather than scroll.
    const rows = detail ? 9 : 8
    const hasGaps = !(e.props.maxRows < rows)
    const hasFooter = !(e.props.maxRows < rows - 1)
    const gap = () => (hasGaps ? <Text> </Text> : null)
    // Fixed segments never shrink; `fit` holds what may give way and clips it.
    const fixed = (...nodes: unknown[]) => <Box flexShrink={0}>{nodes}</Box>
    const fit = (...nodes: unknown[]) => <Box flexShrink={1} overflow="hidden">{nodes}</Box>
    // Dim label, plain value: both timers, right-aligned.
    const stat = (label: string, value: string) => fixed(<Text color="subtle">{'   '}{label} </Text>, <Text>{value}</Text>)

    // Auto on is the loud state: nobody is there to answer, so it reads from across the room.
    const mode = runNow.isAuto ? <Text color="autoAccept" inverse bold> auto on </Text> : <Text color="subtle">auto off</Text>
    // One row: project and milestone left (the milestone name gives way first), then mode, run
    // time and the done / needs-input tally right.
    const [scopeId, scopeName] = splitScope(runNow.scope)
    const header = (
      <Box justifyContent="space-between">
        <Box flexShrink={1}>
          {fixed(
            runNow.project ? <Text bold>{runNow.project}{scopeName ? ': ' : ''}</Text> : null,
            scopeId ? <Text color="subtle">[{scopeId}] </Text> : null,
          )}
          <Text wrap="truncate-end">{scopeName}</Text>
        </Box>
        {fixed(
          <Text>{'   '}</Text>,
          mode,
          stat('run', dur(at - runNow.startedAt)),
          <Text color="subtle">{'  •  '}</Text>,
          total ? <Text bold>{done.length} / {total}{'  '}</Text> : <Text color="subtle" italic>scoping…{'  '}</Text>,
          <Text color={okCount ? 'success' : 'subtle'}>✓ {okCount}</Text>,
          <Text color={badCount ? 'warning' : 'subtle'}>{'  '}✗ {badCount}</Text>,
        )}
      </Box>
    )

    // One row, the bar centred in it, so space sits above and below without a blank row. Each block
    // grows by the issues it stands for. The terminal draws ━, which joins cell to cell: a run longer
    // than any band, clipped by a one-row box. Other surfaces draw text in a proportional font,
    // where glyphs leave gaps and an overlong run wraps, so there the block is a filled box 40% of
    // the row high. Gaps split the issues while each keeps about 3 cells. The key carries the colour.
    const BAR_TONE = { ok: 'success', bad: 'warning', now: tint, todo: 'subtle' } as const
    const split = !!total && total * 3 <= inner
    const blocks = total ? runBar(done.map(one => one.isDone), !!current, total, split) : [{ tone: 'todo' as const, count: 1 }]
    const isTerminal = e.surface === 'terminal'
    const barRow = (
      <Box height={1} alignItems="center">
        {blocks.map((one, i) => {
          const color = BAR_TONE[one.tone]
          const layout = { key: `a${i}-${color}`, width: 0, flexGrow: one.count, flexShrink: 1, marginLeft: split && i ? 1 : 0 }
          return isTerminal ? (
            <Box {...layout} height={1} overflow="hidden">
              <Text color={color}>{'━'.repeat(400)}</Text>
            </Box>
          ) : (
            <Box {...layout} height="40%" backgroundColor={color} />
          )
        })}
      </Box>
    )

    // The issue timer (sized for 59m 59s) shows only while the title keeps 16 cells.
    const idLen = current ? `${current.id}  [${current.size ?? '?'}]  `.length : 0
    const hasIssueTime = !!current && inner - idLen - '   issue 59m 59s'.length >= 16
    const issueRow = current ? (
      <Box justifyContent="space-between">
        <Box flexShrink={1}>
          {fixed(<Text color={tint} bold>{current.id}</Text>, <Text color="subtle">{'  '}[{current.size ?? '?'}]{'  '}</Text>)}
          <Text wrap="truncate-end">{current.title}</Text>
        </Box>
        {hasIssueTime ? stat('issue', dur(at - current.startedAt)) : null}
      </Box>
    ) : (
      <Text color="subtle" italic wrap="truncate-end">picking the next issue…</Text>
    )

    // Same rows in both states, so the band keeps its height between issues. A link turns solid
    // once its phase is reached.
    const phaseRow = fit(
      fixed(
        <Text>{'   '}</Text>,
        ...stages.flatMap((one, i) => [
          !i ? null : one.state === 'done' || one.state === 'now' ? (
            <Text key={`to${i}`} color="success"> ━━ </Text>
          ) : (
            <Text key={`to${i}`} color="subtle"> ── </Text>
          ),
          <Text key={`at${i}`} color={one.state === 'now' ? tint : TONE[one.state]} bold={one.state === 'now'}>
            {GLYPH[one.state]} {one.name}
          </Text>,
        ]),
      ),
    )
    const stepRow = detail ? <Text color="subtle" italic wrap="truncate-end">{`     » ${detail}`}</Text> : null

    // Stats, then the last result, show whole or not at all, so the footer never ends in a stub.
    // The counts are a terminal estimate; on the desktop the group also clips before the tokens.
    const agentsText = `agents ${live.length}/${MAX_AGENTS}`
    const statsText = current ? `   tools ${w.tools}   files ${w.files.length}   commits ${w.commits}` : ''
    const lastText = last ? `   last ${last.isDone ? '✓' : '✗'} ${last.id} ${dur(last.ms)}` : ''
    const tokText = `   ${fmtTokens(runNow.tokens)} tok`
    const room = inner - agentsText.length - tokText.length
    const hasStats = statsText.length <= room
    const hasLast = lastText.length <= room - (hasStats ? statsText.length : 0)
    const footer = hasFooter ? (
      <Box justifyContent="space-between">
        {fit(
          fixed(
            <Text color={live.length >= MAX_AGENTS ? 'warning' : live.length ? tint : 'subtle'}>{agentsText}</Text>,
            statsText && hasStats ? <Text color="subtle">{statsText}</Text> : null,
            last && hasLast ? <Text color={last.isDone ? 'success' : 'warning'}>{lastText}</Text> : null,
          ),
        )}
        {fixed(<Text color="subtle">{tokText}</Text>)}
      </Box>
    ) : null

    return (
      <Box flexDirection="column" borderStyle="round" borderColor="promptBorder" paddingX={2}>
        {header}
        {barRow}
        {issueRow}
        {phaseRow}
        {stepRow}
        {footer ? gap() : null}
        {footer}
      </Box>
    )
  })
}
