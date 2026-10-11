import type { AgentSpawnInput, RenderPropsOf } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { isSubagentBanned, runBar, stepDetail } from '../hooks/ship'
import type { TestBody } from 'claude-code/testing'

const status = (input: Record<string, unknown>) => ({ tool: 'mcp__studio__status' as const, ...input })
const SPAWN = {
  tool_use_id: 't',
  prompt: 'p',
  description: 'write Foo.cs',
  subagentType: 'general-purpose',
  parentModel: 'm',
  background: false,
  fork: false,
} as AgentSpawnInput // the fields the hook reads; the rest is the engine's

// The band's texts in order, joined by |; a run of bar glyphs reads as one glyph.
const band = async ($: Parameters<TestBody>[0], bodyColumns = 100, maxRows?: number, surface: 'terminal' | 'desktop' = 'terminal') => {
  const props = { hasSurvey: false, bodyColumns, maxRows } as RenderPropsOf['AbovePrompt']
  const ui = await $.ui.mount({ plugin: 'studio', surface, component: 'AbovePrompt', props })
  const text = (await ui.findAll({ type: 'Text' })).map(one => (/^(━)\1*$/.test(one.text) ? one.text[0] : one.text)).join('|')
  await ui.unmount()
  return text
}

// The run bar's blocks (its top row): colour x issues it stands for, + where a gap splits it from the one before.
const blocks = async ($: Parameters<TestBody>[0], bodyColumns = 100, surface: 'terminal' | 'desktop' = 'terminal') => {
  const props = { hasSurvey: false, bodyColumns } as RenderPropsOf['AbovePrompt']
  const ui = await $.ui.mount({ plugin: 'studio', surface, component: 'AbovePrompt', props })
  const boxes = (await ui.findAll({ type: 'Box' })) as unknown as { props: Record<string, unknown> }[]
  await ui.unmount()
  return boxes
    .filter(one => /^a\d+-/.test(String(one.props.key)))
    .map(one => `${one.props.marginLeft ? '+' : ''}${String(one.props.key).split('-')[1]}x${one.props.flexGrow}`)
    .join(' ')
}

test('band shows where the run is, the issue and its phases, then the bar and how far along', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start', project: 'Cell', text: 'M2.5 · Organic world', total: 4 }))
  await clock.advance(30_000)
  await $.tool.call(status({ action: 'issue_start', issue: 'GAME-42', title: 'Jump', size: 'M', kind: 'code' }))
  await $.tool.call(status({ action: 'step', text: 'plan' }))
  await clock.advance(3 * 60_000)
  await $.tool.call(status({ action: 'step', text: 'code player controller' }))
  await clock.advance(9 * 60_000 + 30_000)
  await $.tool.call(status({ action: 'step', text: 'verify' }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const text = await band($, 100, undefined, surface)
    // header: project, dim milestone id and name; the mode
    expect(text).toMatch(/^Cell {2}\|M2\.5 \|Organic world\| {3}\|auto off\|/)
    // issue and the tracker, no step row ("verify" says nothing more)
    expect(text).toMatch(/\|auto off\|GAME-42\| {2}\[M\] {2}\|Jump\| {3}\|◉ plan\| ━━ \|◉ work\| ━━ \|◉ verify\| ── \|○ commit\|/)
    // the bar: four blocks on one row (glyphs on the terminal, filled boxes elsewhere)
    expect(text).toMatch(surface === 'terminal' ? /\|○ commit(\|━){4}\|agents/ : /\|○ commit\|agents/)
    expect(await blocks($, 100, surface)).toBe('textx1 +subtlex1 +subtlex1 +subtlex1')
    // footer: subagents and the issue's time; the run's time and the count
    expect(text).toMatch(/\|agents 0\/5\| {3}issue \|12m 30s\| {3}run \|13m 00s\| {3}0 \/ 4$/)
  }
})
test('a done issue lands in the count and the bar', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start', text: 'm2.5', total: 2 }))
  await $.tool.call(status({ action: 'issue_start', issue: 'GAME-1', title: 'A', size: 'S' }))
  await clock.advance(50_000)
  await $.tool.call(status({ action: 'issue_done', text: 'ok' }))
  const text = await band($)
  expect(text).toMatch(/picking the next issue…/)
  expect(text).not.toMatch(/needs input/)
  expect(text).toMatch(/ {3}1 \/ 2$/)
  expect(await blocks($)).toBe('successx1 +subtlex1')
})
test('sixth concurrent subagent is denied, except during council', async ($, on) => {
  mock.clock(on, { now: 0 })
  let n = 0
  on('agent.spawn', () => ({ model: 'm', agentId: `a${++n}` }))
  await $.tool.call(status({ action: 'run_start' }))
  for (let i = 0; i < 5; i++) expect(await $.agent.spawn(SPAWN)).toHaveProperty('agentId')
  expect(await $.agent.spawn(SPAWN)).toHaveProperty('deny')
  expect(await band($)).toMatch(/agents 5\/5/)

  await $.tool.call(status({ action: 'step', text: 'council physics approach' }))
  expect(await $.agent.spawn(SPAWN)).toHaveProperty('agentId')
})

test('no cap outside a run', async ($, on) => {
  mock.clock(on, { now: 0 })
  on('agent.spawn', () => ({ model: 'm', agentId: 'x' }))
  for (let i = 0; i < 6; i++) expect(await $.agent.spawn(SPAWN)).toHaveProperty('agentId')
})

test('a finished subagent frees a cap slot', async ($, on) => {
  mock.clock(on, { now: 0 })
  let n = 0
  on('agent.spawn', () => ({ model: 'm', agentId: `a${++n}` }))
  on('turn.complete', () => ({ text: '' }))
  await $.tool.call(status({ action: 'run_start' }))
  for (let i = 0; i < 5; i++) await $.agent.spawn(SPAWN)
  await $.turn.complete({ agentId: 'a1', reason: 'answer', text: '' } as never)
  expect(await $.agent.spawn(SPAWN)).toHaveProperty('agentId')
})

test('run_end and an aborted main turn both end the run', async ($, on) => {
  mock.clock(on, { now: 0 })
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e); return <Text>engine</Text> })
  on('ui.toast', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  await $.tool.call(status({ action: 'run_start', text: 'm1' }))
  expect(await band($)).toMatch(/auto off/)
  await $.tool.call(status({ action: 'run_end' }))
  expect(await band($)).not.toMatch(/auto off/)

  await $.tool.call(status({ action: 'run_start', text: 'm1' }))
  await $.turn.complete({ reason: 'aborted', text: '' } as never)
  expect(await band($)).not.toMatch(/auto off/)
})

const SESSION = { cwd: '.', surface: 'terminal', isInteractive: true } as const

test('the clock ticks both timers each second during a run', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  on('tool.register', () => ({ value: { tool: 'mcp__studio__status' } }))
  on('session.start', () => ({ cwd: '.' }))
  await $.session.start(SESSION)
  await $.tool.call(status({ action: 'run_start', text: 'm1' }))
  await clock.advance(12_000)
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'S' }))
  await clock.advance(9_000)
  const text = await band($)
  expect(text).toMatch(/run \|21s\|/)
  expect(text).toMatch(/issue \|9s\|/)
})

test('timers share one format: seconds, minutes, hours', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start', text: 'm1' }))
  await clock.advance(4 * 60_000 + 12_000)
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'L' }))
  await clock.advance(60_000 + 48_000)
  await $.tool.call(status({ action: 'step', text: 'plan' }))
  expect(await band($)).toMatch(/issue \|1m 48s\|.*run \|6m 00s\|/)
  await clock.advance(60 * 60_000)
  await $.tool.call(status({ action: 'step', text: 'code' }))
  expect(await band($)).toMatch(/issue \|1h 01m\|.*run \|1h 06m\|/)
})

test('a run with no progress for hours goes stale', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e); return <Text>engine</Text> })
  on('ui.toast', () => ({ value: undefined }))
  on('tool.register', () => ({ value: { tool: 'mcp__studio__status' } }))
  on('session.start', () => ({ cwd: '.' }))
  await $.tool.call(status({ action: 'run_start', text: 'm1' }))
  await clock.advance(5 * 60 * 60_000)
  // The session (and its 1 s clock) starts late so the test does not tick through 5 hours.
  await $.session.start(SESSION)
  await clock.advance(1000)
  expect(await band($)).not.toMatch(/auto off/)
})

test('abort counts as needs input; total can grow', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start', text: 'm1', total: 2 }))
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'S', total: 3 }))
  await $.tool.call(status({ action: 'issue_abort', text: 'stuck' }))
  const text = await band($)
  expect(text).toMatch(/\|agents 0\/5\| {3}1 needs input\| {3}run \|0s\| {3}1 \/ 3$/)
  expect(await blocks($)).toBe('warningx1 +subtlex1 +subtlex1')
})

test('phase tracker goes back; work words enter work', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start' }))
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'M' }))
  for (const [text, mins] of [['code', 5], ['verify', 2], ['code fix', 3], ['code polish', 1]] as const) {
    await $.tool.call(status({ action: 'step', text }))
    await clock.advance(mins * 60_000)
  }
  // the work phase is current; verify was seen and is ahead again
  expect(await band($)).toMatch(/\|◉ plan\| ━━ \|◉ work\| ── \|○ verify\| ── \|○ commit\| {5}» code polish\|/)
})

test('the issue kind, the work words and work itself enter the work phase', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start' }))
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'M', kind: 'UI' }))
  expect(await band($)).toMatch(/\|◉ plan\| ── \|○ work\| ── /)
  await $.tool.call(status({ action: 'step', text: 'plan hud' }))
  await $.tool.call(status({ action: 'step', text: 'ui wire hud' }))
  expect(await band($)).toMatch(/\|◉ plan\| ━━ \|◉ work\| ── \|○ verify\|.*» ui wire hud/)
  await $.tool.call(status({ action: 'step', text: 'work: tidy hud' }))
  expect(await band($)).toMatch(/\|◉ work\| ── .*» tidy hud/)
  await $.tool.call(status({ action: 'issue_done' }))
  expect(await band($)).toMatch(/\|○ plan\| ── \|○ work\| ── /)
  // a kind never takes over the fixed phase words
  await $.tool.call(status({ action: 'issue_start', issue: 'G-3', title: 'C', size: 'S', kind: 'c' }))
  await $.tool.call(status({ action: 'step', text: 'commit rocks' }))
  expect(await band($)).toMatch(/\|◉ work\| ━━ \|◉ verify\| ━━ \|◉ commit\|/)
})
test('the run bar is a block per issue while each keeps 3 cells, else merged runs', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start', project: 'Project Cell', text: 'M2.5 · Organic world', total: 10 }))
  expect(await blocks($, 120)).toBe(['subtlex1', ...Array(9).fill('+subtlex1')].join(' '))
  expect(await blocks($, 30)).toBe('subtlex10')
  expect(await band($, 30)).toMatch(/ {3}0 \/ 10$/)
  // a long queue: the issue in progress, then the rest as one run
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'S', total: 41 }))
  expect(await blocks($, 76)).toBe('textx1 subtlex40')
})

test('on the desktop the layout sizes the bar and clips what gives way, never the run time or count', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start', project: 'Cell', text: 'm1', total: 41 }))
  await $.tool.call(status({ action: 'issue_start', issue: 'CRE-24', title: 'Tune', size: 'L' }))
  await $.tool.call(status({ action: 'step', text: 'M1 gate seeds: 2, 3, 12345' }))
  const props = { hasSurvey: false, bodyColumns: 100 } as RenderPropsOf['AbovePrompt']
  const ui = await $.ui.mount({ plugin: 'studio', surface: 'desktop', component: 'AbovePrompt', props })
  const boxes = (await ui.findAll({ type: 'Box' })) as unknown as { props: Record<string, unknown> }[]
  await ui.unmount()
  // the bar's blocks are filled boxes 40% of the row high, no glyphs: 2 blocks
  expect(boxes.filter(one => one.props.height === '40%' && one.props.backgroundColor)).toHaveLength(2)
  // the tracker and the footer's left side clip too
  expect(boxes.filter(one => one.props.flexShrink === 1 && one.props.overflow === 'hidden')).toHaveLength(2)
  const text = await band($, 100, undefined, 'desktop')
  expect(text).toMatch(/\|○ commit\| {5}» M1 gate seeds: 2, 3, 12345\|/)
  expect(text).toMatch(/ {3}run \|0s\| {3}0 \/ 41$/)
})
test('the step keeps its own row under the tracker', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start' }))
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'S' }))
  await $.tool.call(status({ action: 'step', text: 'build rock noise' }))
  expect(await band($, 100)).toMatch(/\|◉ work\| ── \|○ verify\| ── \|○ commit\| {5}» build rock noise\|━\|agents/)
})
test('the footer shows the issue time only during an issue; the right side never gives way', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start', total: 3 }))
  expect(await band($, 100)).toMatch(/\|agents 0\/5\| {3}run \|0s\| {3}0 \/ 3$/)
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'S' }))
  expect(await band($, 100)).toMatch(/\|agents 0\/5\| {3}issue \|0s\| {3}run \|0s\| {3}0 \/ 3$/)
  const props = { hasSurvey: false, bodyColumns: 30 } as RenderPropsOf['AbovePrompt']
  const ui = await $.ui.mount({ plugin: 'studio', surface: 'terminal', component: 'AbovePrompt', props })
  const boxes = (await ui.findAll({ type: 'Box' })) as unknown as { props: Record<string, unknown> }[]
  await ui.unmount()
  // the tracker and the footer's left side clip (the bar's blocks clip their own glyphs)
  const clips = boxes.filter(one => one.props.flexShrink === 1 && one.props.overflow === 'hidden' && !/^a\d/.test(String(one.props.key)))
  expect(clips).toHaveLength(2)
})
test('band yields to a survey', async ($, on) => {
  mock.clock(on, { now: 0 })
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e); return <Text>engine</Text> })
  await $.tool.call(status({ action: 'run_start', text: 'm1' }))
  const ui = await $.ui.mount({ plugin: 'studio', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: true, bodyColumns: 100 } as RenderPropsOf['AbovePrompt'] })
  expect((await ui.findAll({ type: 'Text' })).map(one => one.text).join('|')).not.toMatch(/auto off/)
})

test('picking state keeps the phase row; scoping shows before a total', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start', text: 'm1' }))
  const text = await band($)
  expect(text).toMatch(/^m1\| {3}\|auto off\|picking the next issue…\|/)
  expect(await blocks($)).toBe('subtlex1')
  expect(text).toMatch(/picking the next issue…\| {3}\|○ plan\| ── \|○ work\| ── \|○ verify\| ── \|○ commit\|━\|agents/)
})

test('a short slot drops the footer; a step row adds one', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start', text: 'm1' }))
  expect(await band($, 100, 7)).toMatch(/commit\|━\|agents 0\/5/)
  const short = await band($, 100, 6)
  expect(short).not.toMatch(/agents/)
  expect(short).toMatch(/picking the next issue…/)
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'S' }))
  await $.tool.call(status({ action: 'step', text: 'code rock noise' }))
  expect(await band($, 100, 8)).toMatch(/commit\| {5}» code rock noise\|━\|agents/)
  expect(await band($, 100, 7)).not.toMatch(/agents/)
})
test('a failed main turn ends the run; an answer (waiting on agents) does not', async ($, on) => {
  mock.clock(on, { now: 0 })
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e); return <Text>engine</Text> })
  on('ui.toast', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  await $.tool.call(status({ action: 'run_start', text: 'm1' }))
  await $.turn.complete({ agentId: 'a1', reason: 'answer', text: '' } as never)
  expect(await band($)).toMatch(/auto off/)
  await $.turn.complete({ reason: 'answer', text: '' } as never)
  expect(await band($)).toMatch(/auto off/)
  await $.turn.complete({ reason: 'error', text: '' } as never)
  expect(await band($)).not.toMatch(/auto off/)
  await $.tool.call(status({ action: 'run_start', text: 'm1' }))
  await $.turn.complete({ reason: 'refusal', text: '' } as never)
  expect(await band($)).not.toMatch(/auto off/)
})

test('issue_start in a new milestone moves the scope', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start', text: 'M1 · Core', total: 3 }))
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'S' }))
  expect(await band($)).toMatch(/^M1 \|Core\|/)
  await $.tool.call(status({ action: 'issue_done', text: 'done note' }))
  expect(await band($)).toMatch(/^M1 \|Core\|/)
  await $.tool.call(status({ action: 'issue_start', issue: 'G-2', title: 'B', size: 'S', text: 'M2 · Polish' }))
  expect(await band($)).toMatch(/^M2 \|Polish\|.* 1 \/ 3$/)
})

test('phase words match whole words only', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start' }))
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'S' }))
  await $.tool.call(status({ action: 'step', text: 'committee notes' }))
  expect(await band($)).toMatch(/\|◉ plan\| ── \|○ work\| ── \|○ verify\| ── \|○ commit\|/)
  await $.tool.call(status({ action: 'step', text: 'commit: shader' }))
  expect(await band($)).toMatch(/\|◉ commit\|/)
})

test('subagents get no git or Unity tools during a run', async ($, on) => {
  mock.clock(on, { now: 0 })
  on('tool.call', () => ({ result: 'ok', text: 'ok', isError: false }) as never)
  const git = { tool: 'Bash', command: 'cd x && git status' } as never
  const unity = { tool: 'mcp__unity__run_command' } as never
  expect(await $.tool.call({ ...(git as object), agentId: 'a1' } as never)).not.toHaveProperty('deny')
  await $.tool.call(status({ action: 'run_start' }))
  expect(await $.tool.call({ ...(git as object), agentId: 'a1' } as never)).toHaveProperty('deny')
  expect(await $.tool.call({ ...(unity as object), agentId: 'a1' } as never)).toHaveProperty('deny')
  expect(await $.tool.call({ tool: 'Bash', command: 'dotnet build legit.csproj', agentId: 'a1' } as never)).not.toHaveProperty('deny')
  expect(await $.tool.call(git)).not.toHaveProperty('deny')
  expect(await $.tool.call({ tool: 'PowerShell', command: 'git push', agentId: 'a1' } as never)).toHaveProperty('deny')
  expect(await $.tool.call({ tool: 'mcp__community__x', agentId: 'a1' } as never)).not.toHaveProperty('deny')
})

test('git and unity CLI ban matches leading space, newlines and env prefixes, not lookalikes', () => {
  for (const c of ['  git status', 'echo a\ngit log', 'FOO=1 git commit', 'x | git diff', '& git push', 'unity status', 'cd p; unity command x'])
    expect(isSubagentBanned('Bash', c)).toBe(true)
  for (const c of ['legit status', 'echo git', 'cat .gitignore', 'dotnet build', 'ls Assets/unity', 'cat UnityProject.sln'])
    expect(isSubagentBanned('Bash', c)).toBe(false)
  expect(isSubagentBanned('unity_cli')).toBe(true)
})

test('a PowerShell commit enters the commit phase', async ($, on) => {
  mock.clock(on, { now: 0 })
  on('tool.call', () => ({ result: 'ok', text: 'ok', isError: false }) as never)
  await $.tool.call(status({ action: 'run_start' }))
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'S' }))
  await $.tool.call({ tool: 'PowerShell', command: 'git commit -m "G-1: x"' } as never)
  expect(await band($)).toMatch(/\|◉ commit\|/)
})

test('a resumed run tracks the issue a step names, though no issue_start came', async ($, on) => {
  mock.clock(on, { now: 0 })
  on('tool.call', () => ({ result: 'ok', text: 'ok', isError: false }) as never)
  await $.tool.call(status({ action: 'run_start', text: 'm1', total: 3 }))
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'S' }))
  // the session restarts mid-issue: run_start again clears the issue
  await $.tool.call(status({ action: 'run_start', text: 'm1', total: 3 }))
  expect(await band($)).toMatch(/picking the next issue…/)
  await $.tool.call(status({ action: 'step', issue: 'G-1', title: 'A', text: 'verify: rerun seeds' }))
  const text = await band($)
  expect(text).toMatch(/\|G-1\| {2}\[\?\] {2}\|A\| {3}\|◉ plan\| ━━ \|◉ work\| ━━ \|◉ verify\| ── \|○ commit\| {5}» rerun seeds\|/)
  // a step with no issue named, once none is current, is milestone work
  await $.tool.call(status({ action: 'issue_done' }))
  await $.tool.call(status({ action: 'step', text: 'code noise' }))
  expect(await band($)).toMatch(/\|milestone work\|/)
})
test('auto mode shows an auto on badge; attended says auto off', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start', project: 'Cell', text: 'm1', total: 2, auto: true }))
  expect(await band($)).toMatch(/^Cell {2}\|m1\| {3}\| auto on \|/)
  await $.tool.call(status({ action: 'run_start', project: 'Cell', text: 'm1', total: 2 }))
  expect(await band($)).toMatch(/\|auto off\|/)
})

test('run bar tones follow the queue: done, needs input, in progress, then the rest', () => {
  const tones = (list: { tone: string; count: number }[]) => list.map(one => `${one.tone}x${one.count}`)
  expect(tones(runBar([true, false], true, 4, true))).toEqual(['okx1', 'badx1', 'nowx1', 'todox1'])
  // unsplit: neighbours of one tone merge
  expect(tones(runBar([true, true], true, 5, false))).toEqual(['okx2', 'nowx1', 'todox2'])
  // more done than the total (issues added unreported) still counts each one
  expect(tones(runBar([true, true, true], false, 2, false))).toEqual(['okx3'])
  expect(runBar([], false, 0, true)).toEqual([])
})
test('the step row drops the phase word it starts with, and only that', () => {
  expect(stepDetail('verify: EditMode tests', 'verify')).toBe('EditMode tests')
  expect(stepDetail('verify', 'verify')).toBe('')
  expect(stepDetail('verifying scene', 'verify')).toBe('verifying scene')
  expect(stepDetail('M1 gate seeds: 2, 3', 'work')).toBe('M1 gate seeds: 2, 3')
  expect(stepDetail('code player controller', 'work')).toBe('code player controller')
})
test('the band advances by itself: edits enter the work step, verify and commits theirs', async ($, on) => {
  mock.clock(on, { now: 0 })
  on('tool.call', () => ({ result: 'ok', text: 'ok', isError: false }) as never)
  await $.tool.call(status({ action: 'run_start' }))
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'S', kind: 'code' }))
  await $.tool.call({ tool: 'Edit', file_path: 'a.cs', old_string: 'x', new_string: 'y' } as never)
  expect(await band($)).toMatch(/\|◉ plan\| ━━ \|◉ work\| ── \|○ verify\|/)
  await $.tool.call({ tool: 'Skill', skill: 'studio:verify' } as never)
  expect(await band($)).toMatch(/\|◉ work\| ━━ \|◉ verify\| ── \|○ commit\|/)
  // a reported step can go back; an edit there does not move it forward
  await $.tool.call(status({ action: 'step', text: 'code fix null ref' }))
  await $.tool.call({ tool: 'Write', file_path: 'b.cs', content: 'z' } as never)
  expect(await band($)).toMatch(/\|◉ work\| ── \|○ verify\|.*» code fix null ref/)
  await $.tool.call({ tool: 'mcp__unity__run_tests' } as never)
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "G-1: x"' } as never)
  expect(await band($)).toMatch(/\|◉ verify\| ━━ \|◉ commit\|/)
})

test('auto marks do not hide a council from the subagent cap', async ($, on) => {
  mock.clock(on, { now: 0 })
  on('tool.call', () => ({ result: 'ok', text: 'ok', isError: false }) as never)
  let n = 0
  on('agent.spawn', () => ({ model: 'm', agentId: `a${++n}` }))
  await $.tool.call(status({ action: 'run_start' }))
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'S' }))
  await $.tool.call(status({ action: 'step', text: 'council: pick upkeep curve' }))
  await $.tool.call({ tool: 'Edit', file_path: 'a.cs', old_string: 'x', new_string: 'y' } as never)
  for (let i = 0; i < 6; i++) expect(await $.agent.spawn(SPAWN)).toHaveProperty('agentId')
})

test('steps with no issue current show as milestone work, not as picking an issue', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start', project: 'Cell', text: 'M2.5 · Organic world', total: 36 }))
  expect(await band($)).toMatch(/picking the next issue…/)
  await $.tool.call(status({ action: 'step', text: 'verify milestone: rerunning M1 seeds 2, 3 on new wall physics' }))
  const text = await band($)
  expect(text).not.toMatch(/picking the next issue…/)
  expect(text).toMatch(/\|M2\.5 {2}\|milestone work\| {3}\|◉ plan\| ━━ \|◉ work\| ━━ \|◉ verify\| ── \|○ commit\| {5}» rerunning M1 seeds 2, 3 on new wall physics\|/)
  // the next issue takes over; done, it goes back to picking
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'S' }))
  expect(await band($)).toMatch(/\|G-1\| {2}\[S\]/)
  await $.tool.call(status({ action: 'issue_done' }))
  expect(await band($)).toMatch(/picking the next issue…/)
})
