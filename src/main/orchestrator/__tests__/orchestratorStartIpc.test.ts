import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    handlers,
    ipcHandle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    workerConstructor: vi.fn(),
    vaultWrite: vi.fn(),
    vaultAppendLog: vi.fn(),
    vaultRead: vi.fn(),
    vaultReadMany: vi.fn(),
    vaultQuery: vi.fn(),
    vaultReadLog: vi.fn(() => []),
    vaultEvict: vi.fn(),
    findCandidates: vi.fn(() => []),
    getRegistry: vi.fn(() => ({ version: 1, default_model: '', nodes: [] })),
    upsertNode: vi.fn()
  }
})

vi.mock('electron', () => ({
  ipcMain: { handle: mocks.ipcHandle }
}))

vi.mock('worker_threads', () => ({
  Worker: class WorkerMock {
    constructor(path: string, options: unknown) {
      mocks.workerConstructor(path, options)
    }

    on(): this {
      return this
    }

    postMessage(): void {}

    terminate(): Promise<number> {
      return Promise.resolve(0)
    }
  }
}))

vi.mock('../vault', () => ({
  vaultWrite: mocks.vaultWrite,
  vaultRead: mocks.vaultRead,
  vaultReadMany: mocks.vaultReadMany,
  vaultQuery: mocks.vaultQuery,
  vaultAppendLog: mocks.vaultAppendLog,
  vaultReadLog: mocks.vaultReadLog,
  vaultEvict: mocks.vaultEvict
}))

vi.mock('../registry', () => ({
  findCandidates: mocks.findCandidates,
  getRegistry: mocks.getRegistry,
  upsertNode: mocks.upsertNode
}))

import { registerOrchestratorIpc } from '../index'

type StartResult = { ok: boolean; projectId?: string; error?: string }
type StartHandler = (event: { sender: { isDestroyed(): boolean; send(...args: unknown[]): void } }, args: unknown) => Promise<StartResult>

const deps = {
  callModel: vi.fn(),
  getDefaultModel: vi.fn(() => 'default-model'),
  papersSearch: vi.fn(),
  papersPdf: vi.fn(),
  anythingEnsure: vi.fn(),
  anythingIngest: vi.fn()
}

function startHandler(): StartHandler {
  const handler = mocks.handlers.get('orch:start')
  if (!handler) throw new Error('orch:start не зарегистрирован')
  return handler as StartHandler
}

function event() {
  return {
    sender: {
      isDestroyed: () => false,
      send: vi.fn()
    }
  }
}

describe('orch:start — доверенная граница WorkflowProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handlers.clear()
    registerOrchestratorIpc(deps)
  })

  it('отклоняет invalid до projectId, Vault, Worker и вызова модели по умолчанию', async () => {
    const e = event()

    const result = await startHandler()(e, {
      goal: 'Цель',
      materials: 'не должны записаться',
      workflowProfile: 'materials'
    })

    expect(result).toEqual({
      ok: false,
      error: 'Некорректные параметры или профиль запуска оркестратора'
    })
    expect(result.projectId).toBeUndefined()
    expect(mocks.workerConstructor).not.toHaveBeenCalled()
    expect(mocks.vaultWrite).not.toHaveBeenCalled()
    expect(mocks.vaultAppendLog).not.toHaveBeenCalled()
    expect(deps.getDefaultModel).not.toHaveBeenCalled()
    expect(e.sender.send).not.toHaveBeenCalled()
  })

  it.each([
    [undefined, 'generic'],
    ['materials_rnd', 'materials_rnd']
  ] as const)('передаёт %s как %s и публикует стартовый trace до Worker', async (workflowProfile, expected) => {
    const e = event()

    const result = await startHandler()(e, { goal: 'Цель', workflowProfile })

    expect(result.ok).toBe(true)
    expect(result.projectId).toMatch(/^p_/)
    expect(mocks.workerConstructor).toHaveBeenCalledOnce()
    const workerOptions = mocks.workerConstructor.mock.calls[0][1] as {
      workerData: { workflowProfile: string }
    }
    expect(workerOptions.workerData.workflowProfile).toBe(expected)
    expect(mocks.vaultAppendLog).toHaveBeenCalledWith(
      result.projectId,
      'root',
      expect.objectContaining({ kind: 'trace', workflow_profile: expected })
    )
    expect(e.sender.send).toHaveBeenCalledWith(
      'orch:trace',
      expect.objectContaining({
        projectId: result.projectId,
        entry: expect.objectContaining({ workflow_profile: expected })
      })
    )
    expect(mocks.vaultAppendLog.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.workerConstructor.mock.invocationCallOrder[0]
    )
    expect(e.sender.send.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.workerConstructor.mock.invocationCallOrder[0]
    )
  })
})
