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

test('band shows issue, phases, time bar and work', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  await $.tool.call(status({ action: 'run_start', text: 'm2.5', total: 4 }))
  await $.tool.call(status({ action: 'issue_start', issue: 'GAME-42', title: 'Jump', size: 'M' }))
  await $.tool.call(status({ action: 'step', text: 'plan' }))
  await clock.advance(3 * 60_000)
  await $.tool.call(status({ action: 'step', text: 'code player controller' }))
  await clock.advance(21 * 60_000)
  await $.tool.call(status({ action: 'step', text: 'verify' }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'devkit', surface, component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 100 } as RenderPropsOf['AbovePrompt'] })
    const text = (await ui.findAll({ type: 'Text' })).map(one => one.text).join('|')
    expect(text).toMatch(/AUTOPILOT/)
    expect(text).toMatch(/m2\.5/)
    expect(text).toMatch(/GAME-42/)
    expect(text).toMatch(/● plan 3m/)
    expect(text).toMatch(/● code 21m/)
    expect(text).toMatch(/◉ verify/)
    expect(text).toMatch(/24m\/30m 80%/)
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
