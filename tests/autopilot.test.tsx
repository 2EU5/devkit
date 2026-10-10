import type { AgentSpawnInput, RenderPropsOf } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const status = (input: Record<string, unknown>) => ({ tool: 'mcp__devkit__status' as const, ...input })
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
  const ui = await $.ui.mount({ plugin: 'devkit', surface, component: 'AbovePrompt', props })
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
    expect(text).toMatch(/^◆ AUTOPILOT\| · \|Cell\| {2}run \|12m 30s\|/)
    // milestone: dim id, name, run bar, count, done and needs-input; then a rule
    expect(text).toMatch(/\|M2\.5 \|Organic world\| {2}\|░{14}\| 0\/4\| {2}✓0\| ✗0\|─{96}\|/)
    // issue, then the stepper, the step and the issue's time
    expect(text).toMatch(/\|▶ GAME-42\| \[M\] \|Jump\| {2}\|✓ plan\| ── \|✓ code\| ── \|● verify\| ── \|○ commit\| {3}» verify\| {2}issue \|12m 30s\|─{96}\|/)
    // footer: agents, work stats and run tokens
    expect(text).toMatch(/\|agents 0\/5\| · tools 0 · files 0 · commits 0\| {2}1\.5k tok$/)
  }
})

test('done issue lands in counters and last result', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start', text: 'm2.5' }))
  await $.tool.call(status({ action: 'issue_start', issue: 'GAME-1', title: 'A', size: 'S' }))
  await clock.advance(50_000)
  await $.tool.call(status({ action: 'issue_done', text: 'ok' }))
  const text = await band($)
  expect(text).toMatch(/picking next issue/)
  expect(text).toMatch(/ {2}✓1\| ✗0/)
  expect(text).toMatch(/ · last ✓ GAME-1 50s/)
})

test('sixth concurrent subagent is denied, except during decide', async ($, on) => {
  mock.clock(on, { now: 0 })
  let n = 0
  on('agent.spawn', () => ({ model: 'm', agentId: `a${++n}` }))
  await $.tool.call(status({ action: 'run_start' }))
  for (let i = 0; i < 5; i++) expect(await $.agent.spawn(SPAWN)).toHaveProperty('agentId')
  expect(await $.agent.spawn(SPAWN)).toHaveProperty('deny')
  expect(await band($)).toMatch(/agents 5\/5/)

  await $.tool.call(status({ action: 'step', text: 'decide physics approach' }))
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
  expect(await band($)).toMatch(/AUTOPILOT/)
  await $.tool.call(status({ action: 'run_end' }))
  expect(await band($)).not.toMatch(/AUTOPILOT/)

  await $.tool.call(status({ action: 'run_start', text: 'm1' }))
  await $.turn.complete({ reason: 'aborted', text: '' } as never)
  expect(await band($)).not.toMatch(/AUTOPILOT/)
})

const SESSION = { cwd: '.', surface: 'terminal', isInteractive: true } as const

test('the clock ticks both timers each second during a run', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  on('tool.register', () => ({ value: { tool: 'mcp__devkit__status' } }))
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
  on('tool.register', () => ({ value: { tool: 'mcp__devkit__status' } }))
  on('session.start', () => ({ cwd: '.' }))
  await $.tool.call(status({ action: 'run_start', text: 'm1' }))
  await clock.advance(5 * 60 * 60_000)
  // The session (and its 1 s clock) starts late so the test does not tick through 5 hours.
  await $.session.start(SESSION)
  await clock.advance(1000)
  expect(await band($)).not.toMatch(/AUTOPILOT/)
})

test('abort counts as needs input; total can grow', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start', text: 'm1', total: 2 }))
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'S', total: 3 }))
  await $.tool.call(status({ action: 'issue_abort', text: 'stuck' }))
  const text = await band($)
  expect(text).toMatch(/ {2}✓0\| ✗1/)
  expect(text).toMatch(/ · last ✗ G-1 0s/)
  expect(text).toMatch(/ 1\/3/)
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
  expect(await band($)).toMatch(/tools 3 · files 1 · commits 1/)
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
  expect(await band($)).toMatch(/\|✓ plan\| ── \|● code\| ── \|◌ verify\| ── \|○ commit\|/)
})

test('the work phase is named by the issue kind', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start' }))
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'M', kind: 'UI' }))
  expect(await band($)).toMatch(/\|○ plan\| ── \|○ ui\| ── /)
  await $.tool.call(status({ action: 'step', text: 'plan hud' }))
  // any work word enters the work phase, still named by the kind
  await $.tool.call(status({ action: 'step', text: 'code bind gene data' }))
  expect(await band($)).toMatch(/\|✓ plan\| ── \|● ui\| ── \|○ verify/)
  await $.tool.call(status({ action: 'issue_done' }))
  expect(await band($)).toMatch(/\|○ plan\| ── \|○ build\| ── /)
  await $.tool.call(status({ action: 'issue_start', issue: 'G-2', title: 'B', size: 'S', kind: 'model' }))
  await $.tool.call(status({ action: 'step', text: 'model rock islands' }))
  expect(await band($)).toMatch(/\|● model\| ── /)
  // a kind never takes over the fixed phase words
  await $.tool.call(status({ action: 'issue_start', issue: 'G-3', title: 'C', size: 'S', kind: 'c' }))
  await $.tool.call(status({ action: 'step', text: 'commit rocks' }))
  expect(await band($)).toMatch(/\|✓ c\| ── \|✓ verify\| ── \|● commit\|/)
})

test('narrow band drops the run bar but keeps the count', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start', project: 'Project Cell', text: 'M2.5 · Organic world and rock islands', total: 10 }))
  const narrow = await band($, 50)
  expect(narrow).not.toMatch(/░/)
  expect(narrow).toMatch(/\|Organic world and rock islands\| {2}\|0\/10\| {2}✓0/)
  expect(await band($, 120)).toMatch(/\| {2}\|░{14}\| 0\/10\|/)
})

test('narrow band drops the issue time, then the step, never the stepper', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start' }))
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'S' }))
  await $.tool.call(status({ action: 'step', text: 'build rock noise' }))
  const wide = await band($, 100)
  expect(wide).toMatch(/» build rock noise\| {2}issue \|0s/)
  const mid = await band($, 60)
  expect(mid).not.toMatch(/issue \|/)
  expect(mid).toMatch(/» build rock noise/)
  const narrow = await band($, 55)
  expect(narrow).not.toMatch(/»/)
  expect(narrow).toMatch(/● build\| ── \|○ verify\| ── \|○ commit/)
})

test('narrow footer drops the stats, then the last result, never cuts them', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start' }))
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'S' }))
  await $.tool.call(status({ action: 'issue_done' }))
  await $.tool.call(status({ action: 'issue_start', issue: 'G-2', title: 'B', size: 'S' }))
  expect(await band($, 100)).toMatch(/\|agents 0\/5\| · tools 0 · files 0 · commits 0\| · last ✓ G-1 0s\| {2}0 tok$/)
  expect(await band($, 50)).toMatch(/\|agents 0\/5\| · last ✓ G-1 0s\| {2}0 tok$/)
  expect(await band($, 30)).toMatch(/\|agents 0\/5\| {2}0 tok$/)
})

test('band yields to a survey', async ($, on) => {
  mock.clock(on, { now: 0 })
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e); return <Text>engine</Text> })
  await $.tool.call(status({ action: 'run_start', text: 'm1' }))
  const ui = await $.ui.mount({ plugin: 'devkit', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: true, bodyColumns: 100 } as RenderPropsOf['AbovePrompt'] })
  expect((await ui.findAll({ type: 'Text' })).map(one => one.text).join('|')).not.toMatch(/AUTOPILOT/)
})

test('picking state keeps the phase row; scoping shows before a total', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start', text: 'm1' }))
  const text = await band($)
  expect(text).toMatch(/\|m1\| {2}\|scoping…\| {2}✓0\| ✗0\|/)
  expect(text).toMatch(/picking next issue\| {2}\|○ plan\| ── \|○ build\| ── \|○ verify\| ── \|○ commit\|/)
})

test('a short slot drops the rules, then the footer', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start', text: 'm1' }))
  const full = await band($, 100, 9)
  expect(full).toMatch(/─{96}/)
  expect(full).toMatch(/agents/)
  const short = await band($, 100, 8)
  expect(short).not.toMatch(/─{96}/)
  expect(short).toMatch(/agents/)
  const shorter = await band($, 100, 6)
  expect(shorter).not.toMatch(/agents/)
  expect(shorter).toMatch(/picking next issue/)
})
