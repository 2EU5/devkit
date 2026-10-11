export type Size = 'S' | 'M' | 'L' | 'XL'
// kind: one lowercase word naming the issue's work phase (code, ui, model, art, …).
export type Issue = { id: string; title: string; size?: Size; kind?: string; startedAt: number }
export type AgentRow = {
  id: string
  description: string
  startedAt: number
  status: 'running' | 'done' | 'failed'
}
export type Run = { project: string; scope: string; startedAt: number; lastAt: number; total?: number; tokens: number }
export type StepEntry = { text: string; at: number }
export type Work = { tools: number; files: string[]; commits: number }
export type IssueResult = { id: string; isDone: boolean; ms: number; note: string }

declare module 'claude-code' {
  interface PluginState {
    studio: {
      isRunning: boolean
      issue: Issue | null
      agents: AgentRow[]
      now: number
      run: Run | null
      steps: StepEntry[]
      work: Work
      results: IssueResult[]
    }
  }
}
