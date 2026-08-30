import { beforeEach, describe, expect, it, vi } from 'vitest'

const phaseMocks = vi.hoisted(() => ({
  researchPhase: vi.fn(),
  webBuildPhase: vi.fn(),
  plan: vi.fn(),
  assembleLecture: vi.fn()
}))

vi.mock('../research', () => ({ researchPhase: phaseMocks.researchPhase }))
vi.mock('../webbuild', () => ({ webBuildPhase: phaseMocks.webBuildPhase }))
vi.mock('../planner', () => ({ plan: phaseMocks.plan }))
vi.mock('../lecture', () => ({
  assembleLecture: phaseMocks.assembleLecture,
  LECTURE_FORGE_PLAYBOOK: 'TEST_LECTURE_PLAYBOOK'
}))

import { DEFAULT_BUDGET, type Runtime, type TaskResult, type TraceDraft } from '../contracts'
import type { OrchestrateOpts } from '../engine'
import { orchestrateWorkflowProfile } from '../profiles'

const webBuildSentinel: TaskResult = {
  task_id: '__webbuild__',
  status: 'success',
  output_vault_key: 'webbuild:key',
  summary: 'Ранний результат webBuild',
  confidence: 0.9,
  cost_spent: { tokens: 100, calls: 1 },
  issues: []
}

function options(workflowProfile: 'generic' | 'materials_rnd'): OrchestrateOpts {
  return {
    goal: 'Научная задача по алюминиевому сплаву',
    budget: DEFAULT_BUDGET,
    depth: 0,
    materials: ['input:key'],
    plannerModel: 'test-model',
    workflowProfile
  }
}

function runtime() {
  const traces: TraceDraft[] = []
  const vaultWrite = vi.fn(
    async (key: string, _content: string, _metadata?: Record<string, unknown>) => key
  )
  let id = 0
  const rt = {
    projectId: 'p_m04',
    depth: 0,
    trace: (entry: TraceDraft) => traces.push(entry),
    status: vi.fn(),
    isCancelled: () => false,
    newId: (prefix: string) => `${prefix}_${id++}`,
    vaultWrite,
    vaultRead: vi.fn(async () => null),
    vaultReadMany: vi.fn(async () => ({}))
  } as unknown as Runtime
  return { rt, traces, vaultWrite }
}

describe('M0.4 — запрет legacy bypass для materials_rnd', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    phaseMocks.researchPhase.mockResolvedValue({
      scientific: true,
      summary: 'Научный контекст',
      materials: ['evidence:key']
    })
    phaseMocks.webBuildPhase.mockResolvedValue({ ran: true, result: webBuildSentinel })
    phaseMocks.plan.mockResolvedValue([])
    phaseMocks.assembleLecture.mockResolvedValue(undefined)
  })

  it('materials_rnd пропускает webBuild и lecture, но продолжает через planner и aggregate', async () => {
    const { rt, traces, vaultWrite } = runtime()

    const result = await orchestrateWorkflowProfile(rt, options('materials_rnd'))

    expect(phaseMocks.researchPhase).toHaveBeenCalledOnce()
    expect(phaseMocks.webBuildPhase).not.toHaveBeenCalled()
    expect(phaseMocks.plan).toHaveBeenCalledOnce()
    expect(phaseMocks.assembleLecture).not.toHaveBeenCalled()
    expect(result).not.toBe(webBuildSentinel)
    expect(result.output_vault_key).toBe('project:p_m04/task:root/output:0')
    expect(vaultWrite).toHaveBeenCalledWith(
      'project:p_m04/tree',
      expect.any(String),
      { kind: 'tree' }
    )
    expect(traces.map((entry) => entry.note)).toContain(
      'materials_rnd state: legacy_bridge_running → finished'
    )
  })

  it('generic сохраняет ранний webBuild-return без planner и lecture', async () => {
    const { rt } = runtime()

    const result = await orchestrateWorkflowProfile(rt, options('generic'))

    expect(phaseMocks.researchPhase).toHaveBeenCalledOnce()
    expect(phaseMocks.webBuildPhase).toHaveBeenCalledOnce()
    expect(phaseMocks.plan).not.toHaveBeenCalled()
    expect(phaseMocks.assembleLecture).not.toHaveBeenCalled()
    expect(result).toBe(webBuildSentinel)
  })

  it('generic сохраняет финальную lecture-сборку после planner', async () => {
    const { rt } = runtime()
    phaseMocks.webBuildPhase.mockResolvedValueOnce({ ran: false })

    const result = await orchestrateWorkflowProfile(rt, options('generic'))

    expect(phaseMocks.webBuildPhase).toHaveBeenCalledOnce()
    expect(phaseMocks.plan).toHaveBeenCalledWith(
      rt,
      'Научная задача по алюминиевому сплаву',
      ['input:key', 'evidence:key'],
      'test-model',
      'TEST_LECTURE_PLAYBOOK'
    )
    expect(phaseMocks.assembleLecture).toHaveBeenCalledWith(
      rt,
      'Научная задача по алюминиевому сплаву',
      ['input:key', 'evidence:key'],
      []
    )
    expect(result).not.toBe(webBuildSentinel)
  })

  it('ошибка materials planner не включает запрещённые фазы как fallback', async () => {
    const { rt, traces } = runtime()
    const failure = new Error('planner failed')
    phaseMocks.plan.mockRejectedValueOnce(failure)

    await expect(orchestrateWorkflowProfile(rt, options('materials_rnd'))).rejects.toBe(failure)
    expect(phaseMocks.webBuildPhase).not.toHaveBeenCalled()
    expect(phaseMocks.assembleLecture).not.toHaveBeenCalled()
    expect(traces.map((entry) => entry.note)).toContain(
      'materials_rnd state: legacy_bridge_running → failed'
    )
  })
})
