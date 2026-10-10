export type Size = 'S' | 'M' | 'L' | 'XL'
export type Issue = { id: string; title: string; size?: Size; startedAt: number }
export type AgentRow = {
  id: string
  description: string
  startedAt: number
  status: 'running' | 'done' | 'failed'
}
export type LogEntry = { at: number; text: string }

declare module 'claude-code' {
  interface PluginState {
    devkit: {
      isRunning: boolean
      issue: Issue | null
      step: string
      agents: AgentRow[]
      log: LogEntry[]
      now: number
    }
  }
}
