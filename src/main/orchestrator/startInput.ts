import { z } from 'zod'
import {
  parseWorkflowProfile,
  type WorkflowProfile
} from '../../shared/orchestrator/workflowProfile'
import type { Budget } from './contracts'

const BudgetPatchSchema = z
  .object({
    project_token_budget: z.number().optional(),
    max_tokens_per_task: z.number().optional(),
    max_iterations_per_mode: z.number().optional(),
    max_parallel_nodes: z.number().optional(),
    max_recursion_depth: z.number().optional()
  })
  .passthrough()

const OrchestratorStartInputEnvelopeSchema = z
  .object({
    goal: z.string(),
    model: z.string().optional(),
    budget: BudgetPatchSchema.optional(),
    materials: z.string().optional(),
    workflowProfile: z.unknown().optional()
  })
  .passthrough()

export type OrchestratorStartInput = {
  goal: string
  model?: string
  budget?: Partial<Budget>
  materials?: string
  workflowProfile: WorkflowProfile
}

export function parseOrchestratorStartInput(raw: unknown): OrchestratorStartInput {
  const parsed = OrchestratorStartInputEnvelopeSchema.parse(raw)
  return {
    goal: parsed.goal,
    model: parsed.model,
    budget: parsed.budget,
    materials: parsed.materials,
    workflowProfile: parseWorkflowProfile(parsed.workflowProfile)
  }
}
