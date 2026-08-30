import { describe, expect, it, vi } from 'vitest'
import type { WorkflowProfile } from '../../../shared/orchestrator/workflowProfile'
import { DEFAULT_BUDGET, type Runtime, type TaskResult, type TraceDraft } from '../contracts'
import type { OrchestrateOpts } from '../engine'
import {
  createMaterialsProfileStateMachine,
  runMaterialsProfileStateMachine,
  transitionMaterialsProfileState
} from '../materialsProfileStateMachine'
import { orchestrate } from '../engine'
import {
  createWorkflowProfileRouter,
  WORKFLOW_PROFILE_RUNNERS,
  type WorkflowProfileRunner,
  type WorkflowProfileRunners
} from '../profiles'

const genericResult: TaskResult = {
  task_id: 'root',
  status: 'success',
  output_vault_key: 'generic:key',
  summary: 'generic result',
  confidence: 0.8,
  cost_spent: { tokens: 10, calls: 1 },
  issues: []
}

const materialsResult: TaskResult = {
  task_id: 'root',
  status: 'partial',
  output_vault_key: 'materials:key',
  summary: 'materials result',
  confidence: 0.6,
  cost_spent: { tokens: 20, calls: 2 },
  issues: ['transitional bridge']
}

function options(workflowProfile: WorkflowProfile, branch = ''): OrchestrateOpts {
  return {
    goal: 'Тестовая цель',
    budget: DEFAULT_BUDGET,
    depth: 0,
    materials: ['context:key'],
    plannerModel: 'test-model',
    workflowProfile,
    branch
  }
}

function fakeRuntime() {
  const traces: TraceDraft[] = []
  let id = 0
  const runtime = {
    trace: (entry: TraceDraft) => traces.push(entry),
    newId: (prefix: string) => `${prefix}_${id++}`
  } as unknown as Runtime
  return { runtime, traces }
}

function runners() {
  const generic: WorkflowProfileRunner = vi.fn(async () => genericResult)
  const materials: WorkflowProfileRunner = vi.fn(async () => materialsResult)
  return {
    generic,
    materials,
    router: createWorkflowProfileRouter({ generic, materials_rnd: materials })
  }
}

describe('маршрутизация WorkflowProfile в M0.3', () => {
  it.each([
    ['generic', 'generic'],
    ['materials_rnd', 'materials']
  ] as const)('вызывает только runner профиля %s', async (workflowProfile, selected) => {
    const { runtime } = fakeRuntime()
    const route = runners()
    const input = options(workflowProfile)

    const result = await route.router(runtime, input)

    const selectedRunner = selected === 'generic' ? route.generic : route.materials
    const otherRunner = selected === 'generic' ? route.materials : route.generic
    expect(selectedRunner).toHaveBeenCalledOnce()
    expect(selectedRunner).toHaveBeenCalledWith(runtime, input)
    expect(otherRunner).not.toHaveBeenCalled()
    expect(result).toBe(selected === 'generic' ? genericResult : materialsResult)
  })

  it('не даёт неизвестному профилю fallback на generic', () => {
    const { runtime } = fakeRuntime()
    const route = runners()
    const invalid = { ...options('generic'), workflowProfile: 'unknown' } as unknown as OrchestrateOpts

    expect(() => route.router(runtime, invalid)).toThrow('Неизвестный WorkflowProfile: unknown')
    expect(route.generic).not.toHaveBeenCalled()
    expect(route.materials).not.toHaveBeenCalled()
  })

  it.each(['generic', 'materials_rnd'] as const)(
    'не подменяет ошибку runner %s и не переключается на другой',
    async (workflowProfile) => {
      const { runtime } = fakeRuntime()
      const failure = new Error(`${workflowProfile} failed`)
      const generic: WorkflowProfileRunner = vi.fn(async () => {
        if (workflowProfile === 'generic') throw failure
        return genericResult
      })
      const materials: WorkflowProfileRunner = vi.fn(async () => {
        if (workflowProfile === 'materials_rnd') throw failure
        return materialsResult
      })
      const router = createWorkflowProfileRouter({ generic, materials_rnd: materials })

      await expect(router(runtime, options(workflowProfile))).rejects.toBe(failure)
      const selectedRunner = workflowProfile === 'generic' ? generic : materials
      const otherRunner = workflowProfile === 'generic' ? materials : generic
      expect(selectedRunner).toHaveBeenCalledOnce()
      expect(otherRunner).not.toHaveBeenCalled()
    }
  )

  it('не смешивает два параллельных маршрута', async () => {
    const { runtime } = fakeRuntime()
    const route = runners()

    const [generic, materials] = await Promise.all([
      route.router(runtime, options('generic')),
      route.router(runtime, options('materials_rnd'))
    ])

    expect(generic).toBe(genericResult)
    expect(materials).toBe(materialsResult)
    expect(route.generic).toHaveBeenCalledOnce()
    expect(route.materials).toHaveBeenCalledOnce()
  })

  it('фиксирует production-сопоставление без возможности его изменить', () => {
    expect(WORKFLOW_PROFILE_RUNNERS.generic).toBe(orchestrate)
    expect(WORKFLOW_PROFILE_RUNNERS.materials_rnd).toBe(runMaterialsProfileStateMachine)
    expect(Object.isFrozen(WORKFLOW_PROFILE_RUNNERS)).toBe(true)
  })
})

describe('начальная state machine профиля materials_rnd', () => {
  it('разрешает только нормативные переходы', () => {
    expect(transitionMaterialsProfileState('selected', 'legacy_bridge_running')).toBe(
      'legacy_bridge_running'
    )
    expect(transitionMaterialsProfileState('legacy_bridge_running', 'finished')).toBe('finished')
    expect(transitionMaterialsProfileState('legacy_bridge_running', 'failed')).toBe('failed')
    expect(() => transitionMaterialsProfileState('selected', 'finished')).toThrow(
      'Недопустимый переход materials_rnd'
    )
    expect(() => transitionMaterialsProfileState('finished', 'selected')).toThrow(
      'Недопустимый переход materials_rnd'
    )
  })

  it('делегирует legacy engine ровно один раз и возвращает исходный результат', async () => {
    const { runtime, traces } = fakeRuntime()
    const legacy: WorkflowProfileRunner = vi.fn(async () => materialsResult)
    const machine = createMaterialsProfileStateMachine(legacy)
    const input = options('materials_rnd', 's1_0~')

    const result = await machine(runtime, input)

    expect(legacy).toHaveBeenCalledOnce()
    expect(legacy).toHaveBeenCalledWith(runtime, input)
    expect(result).toBe(materialsResult)
    expect(traces.map((entry) => entry.note)).toEqual([
      'materials_rnd state: selected → legacy_bridge_running',
      'materials_rnd state: legacy_bridge_running → finished'
    ])
    expect(traces.every((entry) => entry.task_id === 's1_0~__materials_profile__')).toBe(true)
  })

  it('фиксирует failed и пробрасывает исходную ошибку', async () => {
    const { runtime, traces } = fakeRuntime()
    const failure = new Error('legacy failed')
    const legacy: WorkflowProfileRunner = vi.fn(async () => {
      throw failure
    })
    const machine = createMaterialsProfileStateMachine(legacy)

    await expect(machine(runtime, options('materials_rnd'))).rejects.toBe(failure)
    expect(legacy).toHaveBeenCalledOnce()
    expect(traces.map((entry) => entry.note)).toEqual([
      'materials_rnd state: selected → legacy_bridge_running',
      'materials_rnd state: legacy_bridge_running → failed'
    ])
  })

  it('не переписывает обычный failure-результат и завершает lifecycle как finished', async () => {
    const { runtime, traces } = fakeRuntime()
    const failureResult: TaskResult = {
      ...materialsResult,
      status: 'failure',
      summary: 'выполнение завершилось ошибкой'
    }
    const legacy: WorkflowProfileRunner = vi.fn(async () => failureResult)

    const result = await createMaterialsProfileStateMachine(legacy)(
      runtime,
      options('materials_rnd')
    )

    expect(result).toBe(failureResult)
    expect(traces.at(-1)?.note).toBe(
      'materials_rnd state: legacy_bridge_running → finished'
    )
  })

  it('не подменяет исходную ошибку ошибкой аварийного trace', async () => {
    const failure = new Error('legacy failed')
    let traceCalls = 0
    const runtime = {
      newId: (prefix: string) => `${prefix}_${traceCalls}`,
      trace: () => {
        traceCalls += 1
        if (traceCalls === 2) throw new Error('trace failed')
      }
    } as unknown as Runtime
    const legacy: WorkflowProfileRunner = vi.fn(async () => {
      throw failure
    })

    await expect(
      createMaterialsProfileStateMachine(legacy)(runtime, options('materials_rnd'))
    ).rejects.toBe(failure)
    expect(traceCalls).toBe(2)
  })

  it('требует исчерпывающий набор runner на уровне TypeScript', () => {
    const complete: WorkflowProfileRunners = {
      generic: vi.fn(async () => genericResult),
      materials_rnd: vi.fn(async () => materialsResult)
    }

    expect(Object.keys(complete).sort()).toEqual(['generic', 'materials_rnd'])
  })
})
