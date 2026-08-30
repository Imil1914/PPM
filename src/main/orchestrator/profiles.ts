import type { WorkflowProfile } from '../../shared/orchestrator/workflowProfile'
import type { Runtime, TaskResult } from './contracts'
import { orchestrate } from './engine'
import type { OrchestrateOpts } from './engine'
import { runMaterialsProfileStateMachine } from './materialsProfileStateMachine'

export type WorkflowProfileRunner = (
  runtime: Runtime,
  options: OrchestrateOpts
) => Promise<TaskResult>

export type WorkflowProfileRunners = Record<WorkflowProfile, WorkflowProfileRunner>

export function createWorkflowProfileRouter(
  runners: Readonly<WorkflowProfileRunners>
): WorkflowProfileRunner {
  return (runtime, options) => {
    if (!Object.prototype.hasOwnProperty.call(runners, options.workflowProfile)) {
      throw new Error(`Неизвестный WorkflowProfile: ${String(options.workflowProfile)}`)
    }

    return runners[options.workflowProfile](runtime, options)
  }
}

export const WORKFLOW_PROFILE_RUNNERS: Readonly<WorkflowProfileRunners> = Object.freeze({
  generic: orchestrate,
  materials_rnd: runMaterialsProfileStateMachine
})

export const orchestrateWorkflowProfile = createWorkflowProfileRouter(WORKFLOW_PROFILE_RUNNERS)
