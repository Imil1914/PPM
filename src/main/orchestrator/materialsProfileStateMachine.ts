import type { Runtime, TaskResult, TraceDraft } from './contracts'
import { orchestrateMaterialsLegacyBridge } from './engine'
import type { OrchestrateOpts } from './engine'

export type MaterialsProfileState =
  | 'selected'
  | 'legacy_bridge_running'
  | 'finished'
  | 'failed'

export type MaterialsProfileExecutor = (
  runtime: Runtime,
  options: OrchestrateOpts
) => Promise<TaskResult>

const ALLOWED_TRANSITIONS: Record<MaterialsProfileState, readonly MaterialsProfileState[]> = {
  selected: ['legacy_bridge_running'],
  legacy_bridge_running: ['finished', 'failed'],
  finished: [],
  failed: []
}

export function transitionMaterialsProfileState(
  current: MaterialsProfileState,
  next: MaterialsProfileState
): MaterialsProfileState {
  if (!ALLOWED_TRANSITIONS[current].includes(next)) {
    throw new Error(`Недопустимый переход materials_rnd: ${current} → ${next}`)
  }
  return next
}

function transitionTrace(
  runtime: Runtime,
  options: OrchestrateOpts,
  from: MaterialsProfileState,
  to: MaterialsProfileState
): TraceDraft {
  const branch = options.branch || ''
  return {
    command_id: runtime.newId('cmd'),
    task_id: `${branch}__materials_profile__`,
    node_id: 'profile:materials_rnd',
    mode: 'system',
    input_refs: [],
    output_ref: '',
    cost: { tokens: 0, calls: 0 },
    duration_ms: 0,
    timestamp: Date.now(),
    note: `materials_rnd state: ${from} → ${to}`
  }
}

export function createMaterialsProfileStateMachine(
  executeLegacy: MaterialsProfileExecutor
): MaterialsProfileExecutor {
  return async (runtime, options) => {
    let state: MaterialsProfileState = 'selected'
    const running = transitionMaterialsProfileState(state, 'legacy_bridge_running')
    runtime.trace(transitionTrace(runtime, options, state, running))
    state = running

    try {
      const result = await executeLegacy(runtime, options)
      const finished = transitionMaterialsProfileState(state, 'finished')
      runtime.trace(transitionTrace(runtime, options, state, finished))
      return result
    } catch (error) {
      const failed = transitionMaterialsProfileState(state, 'failed')
      try {
        runtime.trace(transitionTrace(runtime, options, state, failed))
      } catch {
        // Ошибка наблюдаемости не должна скрывать исходную ошибку исполнителя.
      }
      throw error
    }
  }
}

export const runMaterialsProfileStateMachine = createMaterialsProfileStateMachine(
  orchestrateMaterialsLegacyBridge
)
