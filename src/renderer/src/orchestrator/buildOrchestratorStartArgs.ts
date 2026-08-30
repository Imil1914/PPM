import {
  parseWorkflowProfile,
  type WorkflowProfile
} from '../../../shared/orchestrator/workflowProfile'

export type OrchestratorStartBudget = Partial<{
  project_token_budget: number
  max_tokens_per_task: number
  max_iterations_per_mode: number
  max_parallel_nodes: number
  max_recursion_depth: number
}>

export type OrchestratorStartArgs = {
  goal: string
  model?: string
  budget?: OrchestratorStartBudget
  materials?: string
  workflowProfile: WorkflowProfile
}

export type OrchestratorStartArgsDraft = Omit<OrchestratorStartArgs, 'workflowProfile'> & {
  workflowProfile?: unknown
}

export function buildOrchestratorStartArgs(draft: OrchestratorStartArgsDraft): OrchestratorStartArgs {
  return {
    ...draft,
    workflowProfile: parseWorkflowProfile(draft.workflowProfile)
  }
}
