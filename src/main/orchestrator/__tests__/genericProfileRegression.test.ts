import { beforeEach, describe, expect, it, vi } from 'vitest'

const phaseMocks = vi.hoisted(() => ({
  researchPhase: vi.fn(),
  webBuildPhase: vi.fn(),
  plan: vi.fn()
}))

vi.mock('../research', () => ({ researchPhase: phaseMocks.researchPhase }))
vi.mock('../webbuild', () => ({ webBuildPhase: phaseMocks.webBuildPhase }))
vi.mock('../planner', () => ({ plan: phaseMocks.plan }))

import { orchestrate } from '../engine'
import { orchestrateWorkflowProfile } from '../profiles'
import { DEFAULT_BUDGET, type Runtime, type TaskResult, type TraceDraft } from '../contracts'

const sentinel: TaskResult = {
  task_id: 'root',
  status: 'success',
  output_vault_key: 'sentinel:key',
  summary: 'Старый webBuild-путь',
  confidence: 0.8,
  cost_spent: { tokens: 10, calls: 1 },
  issues: []
}

function runtime() {
  const traces: TraceDraft[] = []
  const vaultWrite = vi.fn(
    async (key: string, _content: string, _metadata?: Record<string, unknown>) => key
  )
  const rt = {
    projectId: 'p_regression',
    depth: 0,
    trace: (entry: TraceDraft) => traces.push(entry),
    status: vi.fn(),
    isCancelled: () => false,
    newId: (prefix: string) => `${prefix}_1`,
    vaultWrite,
    vaultRead: vi.fn(async () => null)
  } as unknown as Runtime
  return { rt, traces, vaultWrite }
}

describe('регрессия generic engine в M0.2', () => {
  beforeEach(() => {
    phaseMocks.researchPhase.mockReset()
    phaseMocks.webBuildPhase.mockReset()
    phaseMocks.plan.mockReset()
    phaseMocks.researchPhase.mockResolvedValue({ scientific: false, summary: '', materials: [] })
    phaseMocks.webBuildPhase.mockResolvedValue({ ran: true, result: sentinel })
  })

  it('сохраняет прежний ранний webBuild-путь для generic', async () => {
    const { rt } = runtime()

    const result = await orchestrate(rt, {
      goal: 'Регрессионная цель',
      budget: DEFAULT_BUDGET,
      depth: 0,
      materials: [],
      plannerModel: 'test-model',
      workflowProfile: 'generic'
    })

    expect(result).toBe(sentinel)
    expect(phaseMocks.researchPhase).toHaveBeenCalledOnce()
    expect(phaseMocks.webBuildPhase).toHaveBeenCalledOnce()
    expect(phaseMocks.plan).not.toHaveBeenCalled()
  })

  it.each(['generic', 'materials_rnd'] as const)(
    'сохраняет профиль %s в новом дереве задач, не меняя planner',
    async (workflowProfile) => {
      const { rt, vaultWrite } = runtime()
      phaseMocks.webBuildPhase.mockResolvedValueOnce({ ran: false })
      phaseMocks.plan.mockResolvedValueOnce([])

      await orchestrateWorkflowProfile(rt, {
        goal: 'Сохранить дерево',
        budget: DEFAULT_BUDGET,
        depth: 0,
        materials: [],
        plannerModel: 'test-model',
        workflowProfile
      })

      const treeCall = vaultWrite.mock.calls.find(([key]) => key === 'project:p_regression/tree')
      expect(treeCall).toBeDefined()
      expect(phaseMocks.plan).toHaveBeenCalledWith(
        rt,
        'Сохранить дерево',
        [],
        'test-model',
        undefined
      )
      expect(JSON.parse(treeCall![1])).toMatchObject({
        goal: 'Сохранить дерево',
        workflow_profile: workflowProfile,
        tasks: []
      })
    }
  )
})
