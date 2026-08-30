import { z } from 'zod'

export const WorkflowProfileSchema = z.enum(['generic', 'materials_rnd'])

export type WorkflowProfile = z.infer<typeof WorkflowProfileSchema>

export const DEFAULT_WORKFLOW_PROFILE: WorkflowProfile = 'generic'

export function parseWorkflowProfile(value: unknown): WorkflowProfile {
  if (value === undefined || value === null) return DEFAULT_WORKFLOW_PROFILE
  return WorkflowProfileSchema.parse(value)
}
