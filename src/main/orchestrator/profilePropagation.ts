import type { WorkflowProfile } from '../../shared/orchestrator/workflowProfile'
import type { Budget, TraceDraft, TraceEntry, WorkerData } from './contracts'

export type WorkerLaunchData = Omit<WorkerData, 'projectId' | 'cancelBuf'>

type WorkerRuntimeFields = Pick<WorkerData, 'projectId' | 'cancelBuf'>

type ChildWorkerFields = {
  goal: string
  budget: Budget
  depth: number
  materials: string[]
  branch: string
}

export function createWorkerData(runtime: WorkerRuntimeFields, launch: WorkerLaunchData): WorkerData {
  return { ...launch, ...runtime }
}

export function createChildWorkerLaunchData(
  parent: Pick<WorkerData, 'plannerModel' | 'workflowProfile'>,
  child: ChildWorkerFields
): WorkerLaunchData {
  return {
    ...child,
    plannerModel: parent.plannerModel,
    workflowProfile: parent.workflowProfile
  }
}

export function toOrchestrateOpts(workerData: WorkerData) {
  return {
    goal: workerData.goal,
    budget: workerData.budget,
    depth: workerData.depth,
    materials: workerData.materials,
    plannerModel: workerData.plannerModel,
    branch: workerData.branch || '',
    workflowProfile: workerData.workflowProfile
  }
}

export function stampTraceEntry(entry: TraceDraft, workflowProfile: WorkflowProfile): TraceEntry {
  return { ...entry, workflow_profile: workflowProfile }
}

export function createRunStartedTraceEntry(args: {
  projectId: string
  branch: string
  depth: number
  workflowProfile: WorkflowProfile
  timestamp?: number
}): TraceEntry {
  const timestamp = args.timestamp ?? Date.now()
  const runScope = args.branch || 'root'
  return stampTraceEntry(
    {
      command_id: `run:${args.projectId}:${runScope}:${timestamp}`,
      task_id: args.branch ? `${args.branch}root` : 'root',
      node_id: 'system:run',
      mode: 'system',
      input_refs: [],
      output_ref: '',
      cost: { tokens: 0, calls: 0 },
      duration_ms: 0,
      timestamp,
      note: `Запуск оркестратора, глубина ${args.depth}`
    },
    args.workflowProfile
  )
}
