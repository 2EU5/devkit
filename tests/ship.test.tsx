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

// The band's texts in order, joined by |.
const band = async ($: Parameters<TestBody>[0], bodyColumns = 100, maxRows?: number, surface: 'terminal' | 'desktop' = 'terminal') => {
  const props = { hasSurvey: false, bodyColumns, maxRows } as RenderPropsOf['AbovePrompt']
  const ui = await $.ui.mount({ plugin: 'studio', surface, component: 'AbovePrompt', props })
  const text = (await ui.findAll({ type: 'Text' })).map(one => one.text).join('|')
  await ui.unmount()
  return text
}

// The run bar's blocks: background tone x issues it stands for, + where a gap splits it from the one before.
const blocks = async ($: Parameters<TestBody>[0], bodyColumns = 100, surface: 'terminal' | 'desktop' = 'terminal') => {
  const props = { hasSurvey: false, bodyColumns } as RenderPropsOf['AbovePrompt']
  const ui = await $.ui.mount({ plugin: 'studio', surface, component: 'AbovePrompt', props })
  const boxes = (await ui.findAll({ type: 'Box' })) as unknown as { props: Record<string, unknown> }[]
  await ui.unmount()
  return boxes
    .filter(one => one.props.backgroundColor)
    .map(one => `${one.props.marginLeft ? '+' : ''}${one.props.backgroundColor}x${one.props.flexGrow}`)
    .join(' ')
}

test('band shows run, milestone, issue, phases and work', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  on('turn.step', async function* () {
    return { turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'm' } } as never
  })
  await $.tool.call(status({ action: 'run_start', project: 'Cell', text: 'M2.5 · Organic world', total: 4 }))
  await $.tool.call(status({ action: 'issue_start', issue: 'GAME-42', title: 'Jump', size: 'M', kind: 'code' }))
  await $.tool.call(status({ action: 'step', text: 'plan' }))
  await clock.advance(3 * 60_000)
  await $.tool.call(status({ action: 'step', text: 'code player controller' }))
  await clock.advance(9 * 60_000 + 30_000)
  await $.tool.call(status({ action: 'step', text: 'verify' }))
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1 })) void _

  for (const surface of ['terminal', 'desktop'] as const) {
    const text = await band($, 100, undefined, surface)
    // header: project and run time
    expect(text).toMatch(/^▰ Ship: \|Cell\| {3}\|auto off\| {3}run \|12m 30s\|/)
    // milestone: dim id, name, done and needs-input
    expect(text).toMatch(/\|Milestone: \|M2\.5 {3}\|Organic world\| {3}✓ 0\| {3}✗ 0\|/)
    // run bar: four blocks, then the count, then a blank row
    expect(text).toMatch(/✗ 0(\| ){4}\| {3}0 \/ 4\| \|▶/)
    expect(await blocks($, 100, surface)).toBe('claudex1 +subtlex1 +subtlex1 +subtlex1')
    // issue and its time, the tracker, then the step row (blank: "verify" says nothing more) and a blank row
    expect(text).toMatch(/\|▶ GAME-42\| {2}\[M\] {2}\|Jump\| {3}issue \|12m 30s\| {3}\|✓ plan\| ━━ \|✓ work\| ━━ \|● verify\| ── \|○ commit\| \| \|agents/)
    // footer: agents, work stats and run tokens
    expect(text).toMatch(/\|agents 0\/5\| {3}tools 0 {3}files 0 {3}commits 0\| {3}1\.5k tok$/)
  }
})

test('done issue lands in counters and last result', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start', text: 'm2.5' }))
  await $.tool.call(status({ action: 'issue_start', issue: 'GAME-1', title: 'A', size: 'S' }))
  await clock.advance(50_000)
  await $.tool.call(status({ action: 'issue_done', text: 'ok' }))
  const text = await band($)
  expect(text).toMatch(/picking the next issue…/)
  expect(text).toMatch(/ {3}✓ 1\| {3}✗ 0/)
  expect(text).toMatch(/ {3}last ✓ GAME-1 50s/)
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
  expect(await band($)).toMatch(/▰ Ship/)
  await $.tool.call(status({ action: 'run_end' }))
  expect(await band($)).not.toMatch(/▰ Ship/)

  await $.tool.call(status({ action: 'run_start', text: 'm1' }))
  await $.turn.complete({ reason: 'aborted', text: '' } as never)
  expect(await band($)).not.toMatch(/▰ Ship/)
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
  expect(await band($)).toMatch(/run \|6m 00s\|.*issue \|1m 48s\|/)
  await clock.advance(60 * 60_000)
  await $.tool.call(status({ action: 'step', text: 'code' }))
  expect(await band($)).toMatch(/run \|1h 06m\|.*issue \|1h 01m\|/)
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
  expect(await band($)).not.toMatch(/▰ Ship/)
})

test('abort counts as needs input; total can grow', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start', text: 'm1', total: 2 }))
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'S', total: 3 }))
  await $.tool.call(status({ action: 'issue_abort', text: 'stuck' }))
  const text = await band($)
  expect(text).toMatch(/ {3}✓ 0\| {3}✗ 1/)
  expect(text).toMatch(/ {3}last ✗ G-1 0s/)
  expect(text).toMatch(/ {3}1 \/ 3\|/)
  expect(await blocks($)).toBe('warningx1 +subtlex1 +subtlex1')
})

test('work counters: tools, files, commits; refused calls not counted', async ($, on) => {
  mock.clock(on, { now: 0 })
  on('tool.call', ($, e) => (e.tool === 'Bash' && e.command === 'rm -rf /' ? { deny: 'no' } : { result: 'ok', text: 'ok', isError: false }) as never)
  await $.tool.call(status({ action: 'run_start' }))
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'S' }))
  await $.tool.call({ tool: 'Edit', file_path: 'a.cs', old_string: 'x', new_string: 'y' } as never)
  await $.tool.call({ tool: 'Write', file_path: 'a.cs', content: 'z' } as never)
  await $.tool.call({ tool: 'Bash', command: 'git -C sub commit -m "G-1: x"' } as never)
  await $.tool.call({ tool: 'Bash', command: 'rm -rf /' } as never)
  expect(await band($)).toMatch(/tools 3 {3}files 1 {3}commits 1/)
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
  expect(await band($)).toMatch(/\|✓ plan\| ━━ \|● work\| ── \|◌ verify\| ── \|○ commit\| {5}» code polish\|/)
})

test('the issue kind, the work words and work itself enter the work phase', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start' }))
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'M', kind: 'UI' }))
  expect(await band($)).toMatch(/\|● plan\| ── \|○ work\| ── /)
  await $.tool.call(status({ action: 'step', text: 'plan hud' }))
  await $.tool.call(status({ action: 'step', text: 'ui wire hud' }))
  expect(await band($)).toMatch(/\|✓ plan\| ━━ \|● work\| ── \|○ verify\|.*» ui wire hud/)
  await $.tool.call(status({ action: 'step', text: 'work: tidy hud' }))
  expect(await band($)).toMatch(/\|● work\| ── .*» tidy hud/)
  await $.tool.call(status({ action: 'issue_done' }))
  expect(await band($)).toMatch(/\|○ plan\| ── \|○ work\| ── /)
  // a kind never takes over the fixed phase words
  await $.tool.call(status({ action: 'issue_start', issue: 'G-3', title: 'C', size: 'S', kind: 'c' }))
  await $.tool.call(status({ action: 'step', text: 'commit rocks' }))
  expect(await band($)).toMatch(/\|✓ work\| ━━ \|✓ verify\| ━━ \|● commit\|/)
})
test('the run bar is a block per issue while each keeps 3 cells, else merged runs; the count stays whole', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start', project: 'Project Cell', text: 'M2.5 · Organic world', total: 10 }))
  expect(await blocks($, 120)).toBe(['subtlex1', ...Array(9).fill('+subtlex1')].join(' '))
  expect(await blocks($, 30)).toBe('subtlex10')
  expect(await band($, 30)).toMatch(/ {3}0 \/ 10\|/)
  // a long queue: the issue in progress, then the rest as one run
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'S', total: 41 }))
  expect(await blocks($, 76)).toBe('claudex1 subtlex40')
})

test('on the desktop the layout sizes the bar and clips what gives way, never the count or tokens', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start', project: 'Cell', text: 'm1', total: 41 }))
  await $.tool.call(status({ action: 'issue_start', issue: 'CRE-24', title: 'Tune', size: 'L' }))
  await $.tool.call(status({ action: 'step', text: 'M1 gate seeds: 2, 3, 12345' }))
  const props = { hasSurvey: false, bodyColumns: 100 } as RenderPropsOf['AbovePrompt']
  const ui = await $.ui.mount({ plugin: 'studio', surface: 'desktop', component: 'AbovePrompt', props })
  const boxes = (await ui.findAll({ type: 'Box' })) as unknown as { props: Record<string, unknown> }[]
  await ui.unmount()
  // the bar grows and shrinks with the row; the tracker and the footer stats clip
  expect(boxes.filter(one => one.props.flexGrow === 1 && one.props.overflow === 'hidden')).toHaveLength(1)
  expect(boxes.filter(one => one.props.flexShrink === 1 && one.props.overflow === 'hidden').length).toBeGreaterThanOrEqual(3)
  const text = await band($, 100, undefined, 'desktop')
  expect(text).toMatch(/ {3}0 \/ 41\|/)
  expect(text).toMatch(/\|○ commit\| {5}» M1 gate seeds: 2, 3, 12345\|/)
  expect(text).toMatch(/ {3}0 tok$/)
})
test('narrow band drops the issue time; the step keeps its own row', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start' }))
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'S' }))
  await $.tool.call(status({ action: 'step', text: 'build rock noise' }))
  const wide = await band($, 100)
  expect(wide).toMatch(/issue \|0s\|.*\|○ commit\| {5}» build rock noise\|/)
  expect(await band($, 60)).toMatch(/issue \|0s/)
  const narrow = await band($, 45)
  expect(narrow).not.toMatch(/issue \|/)
  expect(narrow).toMatch(/● work\| ── \|○ verify\| ── \|○ commit\| {5}» build rock noise\|/)
})
test('narrow footer drops the stats, then the last result, never cuts them', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start' }))
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'S' }))
  await $.tool.call(status({ action: 'issue_done' }))
  await $.tool.call(status({ action: 'issue_start', issue: 'G-2', title: 'B', size: 'S' }))
  expect(await band($, 100)).toMatch(/\|agents 0\/5\| {3}tools 0 {3}files 0 {3}commits 0\| {3}last ✓ G-1 0s\| {3}0 tok$/)
  expect(await band($, 50)).toMatch(/\|agents 0\/5\| {3}last ✓ G-1 0s\| {3}0 tok$/)
  expect(await band($, 30)).toMatch(/\|agents 0\/5\| {3}0 tok$/)
})

test('band yields to a survey', async ($, on) => {
  mock.clock(on, { now: 0 })
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e); return <Text>engine</Text> })
  await $.tool.call(status({ action: 'run_start', text: 'm1' }))
  const ui = await $.ui.mount({ plugin: 'studio', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: true, bodyColumns: 100 } as RenderPropsOf['AbovePrompt'] })
  expect((await ui.findAll({ type: 'Text' })).map(one => one.text).join('|')).not.toMatch(/▰ Ship/)
})

test('picking state keeps the phase row; scoping shows before a total', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start', text: 'm1' }))
  const text = await band($)
  expect(text).toMatch(/\|Milestone: \|m1\| {3}✓ 0\| {3}✗ 0\| \| {3}scoping…\|/)
  expect(await blocks($)).toBe('subtlex1')
  expect(text).toMatch(/picking the next issue…\| {3}\|○ plan\| ── \|○ work\| ── \|○ verify\| ── \|○ commit\| \|/)
})

test('a short slot drops the blank rows, then the footer', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start', text: 'm1' }))
  const full = await band($, 100, 11)
  expect(full).toMatch(/scoping…\| \|picking/)
  expect(full).toMatch(/commit\| \| \|agents 0\/5/)
  const short = await band($, 100, 10)
  expect(short).toMatch(/scoping…\|picking/)
  expect(short).toMatch(/commit\| \|agents 0\/5/)
  const shorter = await band($, 100, 8)
  expect(shorter).not.toMatch(/agents/)
  expect(shorter).toMatch(/picking the next issue…/)
})

test('a failed main turn ends the run; an answer (waiting on agents) does not', async ($, on) => {
  mock.clock(on, { now: 0 })
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e); return <Text>engine</Text> })
  on('ui.toast', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  await $.tool.call(status({ action: 'run_start', text: 'm1' }))
  await $.turn.complete({ agentId: 'a1', reason: 'answer', text: '' } as never)
  expect(await band($)).toMatch(/▰ Ship/)
  await $.turn.complete({ reason: 'answer', text: '' } as never)
  expect(await band($)).toMatch(/▰ Ship/)
  await $.turn.complete({ reason: 'error', text: '' } as never)
  expect(await band($)).not.toMatch(/▰ Ship/)
  await $.tool.call(status({ action: 'run_start', text: 'm1' }))
  await $.turn.complete({ reason: 'refusal', text: '' } as never)
  expect(await band($)).not.toMatch(/▰ Ship/)
})

test('issue_start in a new milestone moves the scope', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start', text: 'M1 · Core', total: 3 }))
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'S' }))
  expect(await band($)).toMatch(/\|Milestone: \|M1 {3}\|Core\|/)
  await $.tool.call(status({ action: 'issue_done', text: 'done note' }))
  expect(await band($)).toMatch(/\|Milestone: \|M1 {3}\|Core\|/)
  await $.tool.call(status({ action: 'issue_start', issue: 'G-2', title: 'B', size: 'S', text: 'M2 · Polish' }))
  expect(await band($)).toMatch(/\|Milestone: \|M2 {3}\|Polish\|.* 1 \/ 3\|/)
})

test('phase words match whole words only', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start' }))
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'S' }))
  await $.tool.call(status({ action: 'step', text: 'committee notes' }))
  expect(await band($)).toMatch(/\|● plan\| ── \|○ work\| ── \|○ verify\| ── \|○ commit\|/)
  await $.tool.call(status({ action: 'step', text: 'commit: shader' }))
  expect(await band($)).toMatch(/\|● commit\|/)
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

test('a PowerShell commit counts', async ($, on) => {
  mock.clock(on, { now: 0 })
  on('tool.call', () => ({ result: 'ok', text: 'ok', isError: false }) as never)
  await $.tool.call(status({ action: 'run_start' }))
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'S' }))
  await $.tool.call({ tool: 'PowerShell', command: 'git commit -m "G-1: x"' } as never)
  expect(await band($)).toMatch(/commits 1/)
})

test('auto mode shows an auto on badge; attended says auto off', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start', project: 'Cell', text: 'm1', total: 2, auto: true }))
  expect(await band($)).toMatch(/\|Cell\| {3}\| auto on \| {3}run /)
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
  expect(await band($)).toMatch(/\|✓ plan\| ━━ \|● work\| ── \|○ verify\|/)
  await $.tool.call({ tool: 'Skill', skill: 'studio:verify' } as never)
  expect(await band($)).toMatch(/\|✓ work\| ━━ \|● verify\| ── \|○ commit\|/)
  // a reported step can go back; an edit there does not move it forward
  await $.tool.call(status({ action: 'step', text: 'code fix null ref' }))
  await $.tool.call({ tool: 'Write', file_path: 'b.cs', content: 'z' } as never)
  expect(await band($)).toMatch(/\|● work\| ── \|◌ verify\|.*» code fix null ref/)
  await $.tool.call({ tool: 'mcp__unity__run_tests' } as never)
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "G-1: x"' } as never)
  expect(await band($)).toMatch(/\|✓ verify\| ━━ \|● commit\|/)
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
