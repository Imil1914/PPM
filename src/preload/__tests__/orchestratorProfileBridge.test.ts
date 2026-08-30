import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowProfile } from '../../shared/orchestrator/workflowProfile'

const electronMocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn()
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electronMocks.exposeInMainWorld },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: electronMocks.on,
    removeListener: electronMocks.removeListener
  }
}))

import '../index'

type ExposedFlowApi = {
  orchStart: (args: {
    goal: string
    model?: string
    budget?: Record<string, number>
    materials?: string
    workflowProfile?: WorkflowProfile
  }) => Promise<unknown>
}

function getFlowApi(): ExposedFlowApi {
  const call = electronMocks.exposeInMainWorld.mock.calls.find(([name]) => name === 'flow')
  if (!call) throw new Error('preload не опубликовал window.flow')
  return call[1] as ExposedFlowApi
}

describe('preload orchStart', () => {
  beforeEach(() => {
    electronMocks.invoke.mockReset()
    electronMocks.invoke.mockResolvedValue({ ok: true, projectId: 'p_test' })
  })

  it.each(['generic', 'materials_rnd'] as const)('передаёт %s и остальные поля без потерь', async (workflowProfile) => {
    const args = {
      goal: 'Тестовый запуск',
      model: 'test-model',
      materials: 'контекст',
      budget: { project_token_budget: 2_000 },
      workflowProfile
    }

    await getFlowApi().orchStart(args)

    expect(electronMocks.invoke).toHaveBeenCalledOnce()
    expect(electronMocks.invoke).toHaveBeenCalledWith('orch:start', args)
  })
})
