import type { AgentSpawnInput, RenderPropsOf } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { isSubagentBanned, runBar } from '../hooks/ship'
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
    // run bar: one segment per issue, the one in progress first, then the count; then a blank row
    expect(text).toMatch(/\|━{20}\| ─{20} ─{20} ─{20}\| {3}0 \/ 4\| \|/)
    // issue and its time, then the stepper and the step
    expect(text).toMatch(/\|▶ GAME-42\| {2}\[M\] {2}\|Jump\| {3}issue \|12m 30s\| {3}\|✓ plan\| ━━ \|✓ code\| ━━ \|● verify\| ── \|○ commit\| \|/)
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
  expect(text).toMatch(/\|━+\| ─+ ─+\| {3}1 \/ 3\|/)
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

test('phase tracker goes back; without a kind the work phase takes the first work word', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start' }))
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'M' }))
  for (const [text, mins] of [['code', 5], ['verify', 2], ['code fix', 3], ['code polish', 1]] as const) {
    await $.tool.call(status({ action: 'step', text }))
    await clock.advance(mins * 60_000)
  }
  // the work phase is current; verify was seen and is ahead again
  expect(await band($)).toMatch(/\|✓ plan\| ━━ \|● code\| ── \|◌ verify\| ── \|○ commit\|/)
})

test('the work phase is named by the issue kind', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start' }))
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'M', kind: 'UI' }))
  expect(await band($)).toMatch(/\|● plan\| ── \|○ ui\| ── /)
  await $.tool.call(status({ action: 'step', text: 'plan hud' }))
  // any work word enters the work phase, still named by the kind
  await $.tool.call(status({ action: 'step', text: 'code bind gene data' }))
  expect(await band($)).toMatch(/\|✓ plan\| ━━ \|● ui\| ── \|○ verify/)
  await $.tool.call(status({ action: 'issue_done' }))
  expect(await band($)).toMatch(/\|○ plan\| ── \|○ build\| ── /)
  await $.tool.call(status({ action: 'issue_start', issue: 'G-2', title: 'B', size: 'S', kind: 'model' }))
  await $.tool.call(status({ action: 'step', text: 'model rock islands' }))
  expect(await band($)).toMatch(/\|● model\| ── /)
  // a kind never takes over the fixed phase words
  await $.tool.call(status({ action: 'issue_start', issue: 'G-3', title: 'C', size: 'S', kind: 'c' }))
  await $.tool.call(status({ action: 'step', text: 'commit rocks' }))
  expect(await band($)).toMatch(/\|✓ c\| ━━ \|✓ verify\| ━━ \|● commit\|/)
})

test('the run bar fills the row; a long queue goes solid, a narrow band keeps only the count', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start', project: 'Project Cell', text: 'M2.5 · Organic world and rock islands', total: 10 }))
  expect(await band($, 120)).toMatch(/\|─{9}( ─{9}){9}\| {3}0 \/ 10\|/)
  expect(await band($, 50)).toMatch(/\|──( ──){9}\| {3}0 \/ 10\|/)
  const narrow = await band($, 20)
  expect(narrow).not.toMatch(/─ ─/)
  expect(narrow).toMatch(/\|Organic world and rock islands\| {3}✓ 0/)
  expect(narrow).toMatch(/ {3}0 \/ 10\|/)
  // more issues than fit at 2 cells: one solid line split by issue
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'S', total: 41 }))
  expect(await band($, 76)).toMatch(/\|━━\|─{57}\| {3}0 \/ 41\|/)
})

test('narrow band drops the step, then the issue time, then folds the steps to come', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start' }))
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'S' }))
  await $.tool.call(status({ action: 'step', text: 'build rock noise' }))
  const wide = await band($, 100)
  expect(wide).toMatch(/issue \|0s\|.*» build rock noise/)
  const mid = await band($, 60)
  expect(mid).not.toMatch(/»/)
  expect(mid).toMatch(/issue \|0s/)
  const narrow = await band($, 45)
  expect(narrow).not.toMatch(/issue \|/)
  expect(narrow).toMatch(/\|✓ 1 done\| ━━ \|● build\| ── \|○ 2 more\|/)
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
  expect(text).toMatch(/\|Milestone: \|m1\| {3}✓ 0\| {3}✗ 0\|─{82}\| {3}scoping…\|/)
  expect(text).toMatch(/picking the next issue…\| {3}\|○ plan\| ── \|○ build\| ── \|○ verify\| ── \|○ commit\|/)
})

test('a short slot drops the blank rows, then the footer', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start', text: 'm1' }))
  const full = await band($, 100, 10)
  expect(full).toMatch(/scoping…\| \|picking/)
  expect(full).toMatch(/commit\| \|agents 0\/5/)
  const short = await band($, 100, 9)
  expect(short).toMatch(/scoping…\|picking/)
  expect(short).toMatch(/commit\|agents 0\/5/)
  const shorter = await band($, 100, 7)
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
  expect(await band($)).toMatch(/\|● plan\| ── \|○ build\| ── \|○ verify\| ── \|○ commit\|/)
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

test('auto mode tints the band and says so; attended says auto off', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start', project: 'Cell', text: 'm1', total: 2, auto: true }))
  expect(await band($)).toMatch(/\|Cell\| {3}\| auto on \| {3}run /)
  await $.tool.call(status({ action: 'run_start', project: 'Cell', text: 'm1', total: 2 }))
  expect(await band($)).toMatch(/\|auto off\|/)
})

test('run bar tones follow the queue: done, needs input, in progress, then the rest', () => {
  const tones = (parts: { text: string; tone: string }[]) => parts.map(one => `${one.tone}:${one.text}`)
  expect(tones(runBar([true, false], true, 4, 11))).toEqual(['ok:━━', 'bad: ━━', 'now: ━━', 'todo: ──'])
  // a long queue maps cells onto issues
  expect(tones(runBar([true], false, 10, 5))).toEqual(['ok:━', 'todo:────'])
  expect(runBar([], false, 0, 10)).toEqual([])
})

test('an issue can bring its own steps, set at issue_start or after planning', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start' }))
  const plan = ['plan', 'balance round 1', 'balance round 2', 'verify', 'commit']
  await $.tool.call(status({ action: 'issue_start', issue: 'CRE-24', title: 'Tune upkeep', size: 'L', steps: plan }))
  expect(await band($, 120)).toMatch(/\|● plan\| ── \|○ balance round 1\| ── \|○ balance round 2\| ── \|○ verify\| ── \|○ commit\|/)
  // the longest step name wins; the step text shows when it says more than the name
  await $.tool.call(status({ action: 'step', text: 'balance round 2 pellet energy' }))
  expect(await band($, 120)).toMatch(/\|✓ balance round 1\| ━━ \|● balance round 2\| ── \|○ verify\|.*» balance round 2 pellet energy/)
  // a new plan after planning replaces the steps
  await $.tool.call(status({ action: 'issue_start', issue: 'CRE-25', title: 'B', size: 'M' }))
  await $.tool.call(status({ action: 'step', text: 'plan', steps: ['plan', 'shader', 'material', 'verify', 'commit'] }))
  await $.tool.call(status({ action: 'step', text: 'material pass' }))
  expect(await band($, 120)).toMatch(/\|✓ plan\| ━━ \|✓ shader\| ━━ \|● material\| ── \|○ verify\|/)
})

test('the band advances by itself: edits enter the work step, verify and commits theirs', async ($, on) => {
  mock.clock(on, { now: 0 })
  on('tool.call', () => ({ result: 'ok', text: 'ok', isError: false }) as never)
  await $.tool.call(status({ action: 'run_start' }))
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'S', kind: 'code' }))
  await $.tool.call({ tool: 'Edit', file_path: 'a.cs', old_string: 'x', new_string: 'y' } as never)
  expect(await band($)).toMatch(/\|✓ plan\| ━━ \|● code\| ── \|○ verify\|/)
  await $.tool.call({ tool: 'Skill', skill: 'studio:verify' } as never)
  expect(await band($)).toMatch(/\|✓ code\| ━━ \|● verify\| ── \|○ commit\|/)
  // a reported step can go back; an edit there does not move it forward
  await $.tool.call(status({ action: 'step', text: 'code fix null ref' }))
  await $.tool.call({ tool: 'Write', file_path: 'b.cs', content: 'z' } as never)
  expect(await band($)).toMatch(/\|● code\| ── \|◌ verify\|.*» code fix null ref/)
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
