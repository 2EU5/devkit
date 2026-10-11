export type Size = 'S' | 'M' | 'L' | 'XL'
// kind: one lowercase word naming the issue's main work (code, ui, model, art, …).
export type Issue = { id: string; title: string; size?: Size; kind?: string; startedAt: number }
export type AgentRow = {
  id: string
  description: string
  startedAt: number
  status: 'running' | 'done' | 'failed'
}
export type Run = { project: string; scope: string; startedAt: number; lastAt: number; total?: number; tokens: number; isAuto: boolean }
// A step the agent reported, or an auto mark the band inferred from the work.
export type AutoMark = 'plan' | 'work' | 'verify' | 'commit'
export type StepEntry = { text: string; at: number; auto?: AutoMark }
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
