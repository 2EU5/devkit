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

test('band shows issue, size and time against limit', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  on('ui.open', () => ({ value: { isPlaced: false as const, reason: 'test' } }))
  await $.tool.call(status({ action: 'run_start' }))
  await $.tool.call(status({ action: 'issue_start', issue: 'GAME-42', title: 'Jump', size: 'M' }))
  await clock.advance(12 * 60_000)
  await $.tool.call(status({ action: 'step', text: 'verify' }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'devkit', surface, component: 'AbovePrompt', props: { hasSurvey: false } as RenderPropsOf['AbovePrompt'] })
    expect((await ui.find({ type: 'Text' }))?.text).toMatch(/GAME-42 · M · 12\/30m · verify · 0 agents/)
    await ui.unmount()
  }
})

test('fourth concurrent subagent is denied, except during decide', async ($, on) => {
  mock.clock(on, { now: 0 })
  on('ui.open', () => ({ value: { isPlaced: false as const, reason: 'test' } }))
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
