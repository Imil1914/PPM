import { describe, expect, expectTypeOf, it } from 'vitest'
import { ZodError } from 'zod'
import type { WorkflowProfile } from '../../../shared/orchestrator/workflowProfile'
import { DEFAULT_BUDGET, type TraceDraft, type TraceEntry, type WorkerData } from '../contracts'
import type { OrchestrateOpts } from '../engine'
import {
  createChildWorkerLaunchData,
  createRunStartedTraceEntry,
  createWorkerData,
  stampTraceEntry,
  toOrchestrateOpts,
  type WorkerLaunchData
} from '../profilePropagation'
import { parseOrchestratorStartInput } from '../startInput'

const runtime = {
  projectId: 'p_test',
  cancelBuf: new SharedArrayBuffer(4)
}

function launchData(workflowProfile: WorkflowProfile): WorkerLaunchData {
  return {
    goal: 'Тестовая цель',
    budget: DEFAULT_BUDGET,
    depth: 0,
    materials: ['context:key'],
    plannerModel: 'test-model',
    workflowProfile,
    branch: ''
  }
}

const traceDraft: TraceDraft = {
  command_id: 'cmd_1',
  task_id: 'root',
  node_id: 'system:run',
  mode: 'system',
  input_refs: [],
  output_ref: '',
  cost: { tokens: 0, calls: 0 },
  duration_ms: 0,
  timestamp: 1
}

describe('сквозная передача WorkflowProfile', () => {
  it('делает профиль обязательным во внутренних контрактах', () => {
    expectTypeOf<WorkerData['workflowProfile']>().toEqualTypeOf<WorkflowProfile>()
    expectTypeOf<OrchestrateOpts['workflowProfile']>().toEqualTypeOf<WorkflowProfile>()
    expectTypeOf<TraceEntry['workflow_profile']>().toEqualTypeOf<WorkflowProfile>()
  })

  it.each([undefined, null])('назначает generic только отсутствующему IPC-значению: %s', (workflowProfile) => {
    const parsed = parseOrchestratorStartInput({ goal: 'Цель', workflowProfile })
    const workerData = createWorkerData(runtime, launchData(parsed.workflowProfile))

    expect(parsed.workflowProfile).toBe('generic')
    expect(workerData.workflowProfile).toBe('generic')
    expect(toOrchestrateOpts(workerData).workflowProfile).toBe('generic')
  })

  it('передаёт materials_rnd через root, child и engine без возможности подмены ребёнком', () => {
    const parsed = parseOrchestratorStartInput({ goal: 'Цель', workflowProfile: 'materials_rnd' })
    const root = createWorkerData(runtime, launchData(parsed.workflowProfile))
    const childRequestWithUntrustedExtra = {
      goal: 'Подзадача',
      budget: DEFAULT_BUDGET,
      depth: 1,
      materials: ['child:key'],
      branch: 's1_0~',
      workflowProfile: 'generic'
    }
    const childLaunch = createChildWorkerLaunchData(root, childRequestWithUntrustedExtra)
    const child = createWorkerData(runtime, childLaunch)

    expect(root.workflowProfile).toBe('materials_rnd')
    expect(child.workflowProfile).toBe('materials_rnd')
    expect(toOrchestrateOpts(child).workflowProfile).toBe('materials_rnd')
  })

  it.each(['materials', 'GENERIC', '', 'materials_rnd ', 123, {}])('отклоняет IPC-профиль %p', (workflowProfile) => {
    expect(() => parseOrchestratorStartInput({ goal: 'Цель', workflowProfile })).toThrow(ZodError)
  })

  it.each(['generic', 'materials_rnd'] as const)('добавляет %s в машинно-читаемый trace', (workflowProfile) => {
    expect(stampTraceEntry(traceDraft, workflowProfile)).toEqual({
      ...traceDraft,
      workflow_profile: workflowProfile
    })
  })

  it('создаёт стартовый trace до запуска worker, включая профиль и ветвь', () => {
    expect(
      createRunStartedTraceEntry({
        projectId: 'p_test',
        branch: 's1_0~',
        depth: 1,
        workflowProfile: 'materials_rnd',
        timestamp: 100
      })
    ).toMatchObject({
      command_id: 'run:p_test:s1_0~:100',
      task_id: 's1_0~root',
      node_id: 'system:run',
      workflow_profile: 'materials_rnd',
      timestamp: 100
    })
  })

  it('не смешивает профили параллельных запусков', () => {
    const genericRun = createWorkerData(
      { projectId: 'p_generic', cancelBuf: new SharedArrayBuffer(4) },
      launchData('generic')
    )
    const materialsRun = createWorkerData(
      { projectId: 'p_materials', cancelBuf: new SharedArrayBuffer(4) },
      launchData('materials_rnd')
    )

    expect(stampTraceEntry(traceDraft, genericRun.workflowProfile).workflow_profile).toBe('generic')
    expect(stampTraceEntry(traceDraft, materialsRun.workflowProfile).workflow_profile).toBe('materials_rnd')
  })
})
