import type { AgentSpawnInput, RenderPropsOf } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

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

test('band shows header, issue, phases and work', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  on('turn.step', async function* () {
    return { turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'm' } } as never
  })
  await $.tool.call(status({ action: 'run_start', project: 'Cell', text: 'm2.5', total: 4 }))
  await $.tool.call(status({ action: 'issue_start', issue: 'GAME-42', title: 'Jump', size: 'M' }))
  await $.tool.call(status({ action: 'step', text: 'plan' }))
  await clock.advance(3 * 60_000)
  await $.tool.call(status({ action: 'step', text: 'code player controller' }))
  await clock.advance(9 * 60_000)
  await $.tool.call(status({ action: 'step', text: 'verify' }))
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1 })) void _

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'devkit', surface, component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 100 } as RenderPropsOf['AbovePrompt'] })
    const text = (await ui.findAll({ type: 'Text' })).map(one => one.text).join('|')
    // header carries the run bar; milestone and issue rows follow, labelled
    expect(text).toMatch(/AUTOPILOT\| {3}Cell\| {3}\|█*\|░+\| 0\/4 issues\|.*\|milestone \|m2\.5\|issue {5}\|GAME-42/)
    expect(text).toMatch(/m2\.5/)
    expect(text).toMatch(/GAME-42/)
    expect(text).toMatch(/● plan 3m/)
    expect(text).toMatch(/● code 9m/)
    expect(text).toMatch(/◉ verify/)
    expect(text).toMatch(/1\.5k tok/)
    expect(text).toMatch(/0\/4 issues/)
    await ui.unmount()
  }
})

test('done issue lands in counters and last result', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start', text: 'm2.5' }))
  await $.tool.call(status({ action: 'issue_start', issue: 'GAME-1', title: 'A', size: 'S' }))
  await $.tool.call(status({ action: 'issue_done', text: 'ok' }))
  const ui = await $.ui.mount({ plugin: 'devkit', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 100 } as RenderPropsOf['AbovePrompt'] })
  const text = (await ui.findAll({ type: 'Text' })).map(one => one.text).join('|')
  expect(text).toMatch(/picking next issue/)
  expect(text).toMatch(/✓ 1/)
  expect(text).toMatch(/last ✓ GAME-1/)
})

test('fourth concurrent subagent is denied, except during decide', async ($, on) => {
  mock.clock(on, { now: 0 })
  let n = 0
  on('agent.spawn', () => ({ model: 'm', agentId: `a${++n}` }))
  await $.tool.call(status({ action: 'run_start' }))
  for (let i = 0; i < 3; i++) expect(await $.agent.spawn(SPAWN)).toHaveProperty('agentId')
  expect(await $.agent.spawn(SPAWN)).toHaveProperty('deny')

  await $.tool.call(status({ action: 'step', text: 'decide physics approach' }))
  expect(await $.agent.spawn(SPAWN)).toHaveProperty('agentId')
})

test('no cap outside a run', async ($, on) => {
  mock.clock(on, { now: 0 })
  on('agent.spawn', () => ({ model: 'm', agentId: 'x' }))
  for (let i = 0; i < 4; i++) expect(await $.agent.spawn(SPAWN)).toHaveProperty('agentId')
})

const band = async ($: Parameters<Parameters<typeof test>[1]>[0], bodyColumns = 100) => {
  const ui = await $.ui.mount({ plugin: 'devkit', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns } as RenderPropsOf['AbovePrompt'] })
  const text = (await ui.findAll({ type: 'Text' })).map(one => one.text).join('|')
  await ui.unmount()
  return text
}

test('a finished subagent frees a cap slot', async ($, on) => {
  mock.clock(on, { now: 0 })
  let n = 0
  on('agent.spawn', () => ({ model: 'm', agentId: `a${++n}` }))
  on('turn.complete', () => ({ text: '' }))
  await $.tool.call(status({ action: 'run_start' }))
  for (let i = 0; i < 3; i++) await $.agent.spawn(SPAWN)
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

test('a run with no progress for hours goes stale', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e); return <Text>engine</Text> })
  on('ui.toast', () => ({ value: undefined }))
  on('tool.register', () => ({ value: { tool: 'mcp__devkit__status' } }))
  on('session.start', () => ({ cwd: '.' }) as never)
  await $.session.start({} as never)
  await $.tool.call(status({ action: 'run_start', text: 'm1' }))
  await clock.advance(5 * 60 * 60_000)
  expect(await band($)).not.toMatch(/AUTOPILOT/)
})

test('abort counts as needs input; total can grow', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start', text: 'm1', total: 2 }))
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'S', total: 3 }))
  await $.tool.call(status({ action: 'issue_abort', text: 'stuck' }))
  const text = await band($)
  expect(text).toMatch(/✗ 1/)
  expect(text).toMatch(/last ✗ G-1/)
  expect(text).toMatch(/1\/3 issues/)
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
  expect(await band($)).toMatch(/3 tools · 1 files · 1 commits/)
})

test('phase tracker goes back and adds up minutes', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start' }))
  await $.tool.call(status({ action: 'issue_start', issue: 'G-1', title: 'A', size: 'M' }))
  for (const [text, mins] of [['code', 5], ['verify', 2], ['code fix', 3], ['code polish', 1]] as const) {
    await $.tool.call(status({ action: 'step', text }))
    await clock.advance(mins * 60_000)
  }
  const text = await band($)
  expect(text).toMatch(/◉ code 8m/) // band time is the last status call's
  expect(text).toMatch(/○ verify 2m/)
})

test('narrow band drops the run bar but keeps the count', async ($, on) => {
  mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start', project: 'Project Cell', text: 'm1', total: 10 }))
  const header = (await band($, 60)).split('|milestone')[0]
  expect(header).not.toMatch(/░/)
  expect(header).toMatch(/0\/10 issues/)
  expect((await band($, 120)).split('|milestone')[0]).toMatch(/░/)
})

test('band yields to a survey', async ($, on) => {
  mock.clock(on, { now: 0 })
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e); return <Text>engine</Text> })
  await $.tool.call(status({ action: 'run_start', text: 'm1' }))
  const ui = await $.ui.mount({ plugin: 'devkit', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: true, bodyColumns: 100 } as RenderPropsOf['AbovePrompt'] })
  expect((await ui.findAll({ type: 'Text' })).map(one => one.text).join('|')).not.toMatch(/AUTOPILOT/)
})
