import { describe, expect, expectTypeOf, it } from 'vitest'
import type { AiChatResult, Runtime } from '../contracts'
import {
  FakeRuntime,
  FakeRuntimeBackend,
  UnexpectedFakeRuntimeCall,
  fakeEffect
} from './fakeRuntime'
import {
  aiTextFixture,
  boardNodeFixture,
  nodeRegistryFixture,
  paperFixture,
  taskResultFixture
} from './fakeFixtures'

function aiArgs(model: string) {
  return {
    model,
    messages: [{ role: 'user' as const, content: `request for ${model}` }]
  }
}

describe('FakeRuntime — полный test-only контракт Runtime', () => {
  it('реализует Runtime на уровне TypeScript без type casts', () => {
    const runtime: Runtime = new FakeRuntime()

    expectTypeOf(runtime).toMatchTypeOf<Runtime>()
    expect(runtime.projectId).toBe('fixture-project')
    expect(runtime.depth).toBe(0)
  })

  it('хранит Vault, metadata, query и log с защитными копиями', async () => {
    const runtime = new FakeRuntime({ projectId: 'vault-project' }).queueVaultQuery(
      fakeEffect(['notes/alpha'], ({ query, filters }) =>
        query === 'alpha' &&
        filters?.kind === 'fixture' &&
        filters?.key_prefix === 'notes/'
      ),
      fakeEffect([], ({ query, filters }) => query === '' && filters?.project_id === 'another-project')
    )
    const metadata = { kind: 'fixture', revision: 1 }
    const event = { state: 'created', details: { attempt: 1 } }

    await runtime.vaultWrite('notes/alpha', 'Alpha fixture text', metadata)
    await runtime.vaultWrite('notes/beta', 'Beta fixture text', {
      kind: 'other',
      revision: 1
    })
    metadata.kind = 'mutated-after-write'

    expect(await runtime.vaultRead('notes/alpha')).toBe('Alpha fixture text')
    expect(await runtime.vaultRead('missing')).toBeNull()
    expect(await runtime.vaultReadMany(['notes/alpha', 'missing', 'notes/beta'])).toEqual({
      'notes/alpha': 'Alpha fixture text',
      'notes/beta': 'Beta fixture text'
    })
    expect(await runtime.vaultQuery('alpha', { kind: 'fixture', key_prefix: 'notes/' })).toEqual([
      'notes/alpha'
    ])
    expect(await runtime.vaultQuery('', { project_id: 'another-project' })).toEqual([])

    await runtime.vaultAppendLog('fixture-task', event)
    event.details.attempt = 99
    const firstLog = runtime.taskLog('fixture-task') as Array<{
      state: string
      details: { attempt: number }
    }>
    firstLog[0].details.attempt = 77
    expect(runtime.taskLog('fixture-task')).toEqual([
      { state: 'created', details: { attempt: 1 } }
    ])

    const snapshot = runtime.vaultSnapshot()
    snapshot['notes/alpha'].metadata!.kind = 'mutated-snapshot'
    expect(runtime.vaultSnapshot()['notes/alpha'].metadata).toEqual({
      kind: 'fixture',
      revision: 1
    })
    runtime.verify()
  })

  it('делит backend внутри проекта и изолирует разные проекты', async () => {
    const backend = new FakeRuntimeBackend(40)
    const root = new FakeRuntime({ projectId: 'shared-project', depth: 0, backend })
    const child = new FakeRuntime({ projectId: 'shared-project', depth: 1, backend })
    const foreign = new FakeRuntime({ projectId: 'foreign-project', backend })

    await root.vaultWrite('shared/key', 'root value', { owner: 'root' })
    expect(await child.vaultRead('shared/key')).toBe('root value')
    expect(await foreign.vaultRead('shared/key')).toBeNull()

    await foreign.vaultWrite('shared/key', 'foreign value')
    expect(await root.vaultRead('shared/key')).toBe('root value')
    expect(await foreign.vaultRead('shared/key')).toBe('foreign value')

    expect(root.newId('cmd')).toBe('cmd_shared-project_41')
    expect(child.newId('cmd')).toBe('cmd_shared-project_42')
    expect(foreign.newId('cmd')).toBe('cmd_foreign-project_41')

    child.cancel('fixture stop')
    root.cancel('ignored second reason')
    expect(root.isCancelled()).toBe(true)
    expect(child.cancellationReason()).toBe('fixture stop')
    expect(foreign.isCancelled()).toBe(false)

    root.verify()
    child.verify()
    foreign.verify()
  })

  it('создаёт одинаковые id для одинакового seed и не использует время или случайность', () => {
    const first = new FakeRuntime({ projectId: 'stable', idSeed: 8 })
    const second = new FakeRuntime({ projectId: 'stable', idSeed: 8 })

    expect([first.newId('task'), first.newId('task'), first.newId('run')]).toEqual([
      'task_stable_9',
      'task_stable_10',
      'run_stable_9'
    ])
    expect([second.newId('task'), second.newId('task'), second.newId('run')]).toEqual([
      'task_stable_9',
      'task_stable_10',
      'run_stable_9'
    ])
  })
})

describe('FakeRuntime — строгие сценарии внешних эффектов', () => {
  it('отклоняет каждый нескриптованный внешний эффект', async () => {
    const invocations: Array<{
      method: string
      invoke: (runtime: FakeRuntime) => Promise<unknown>
    }> = [
      { method: 'aiChat', invoke: (runtime) => runtime.aiChat(aiArgs('fixture::model')) },
      { method: 'findCandidates', invoke: (runtime) => runtime.findCandidates({ type: 'writer' }) },
      { method: 'vaultQuery', invoke: (runtime) => runtime.vaultQuery('fixture') },
      {
        method: 'humanRequest',
        invoke: (runtime) =>
          runtime.humanRequest({
            task_id: 'fixture-task',
            reason: 'fixture review',
            best_output_key: 'fixture/output',
            best_summary: 'fixture summary'
          })
      },
      {
        method: 'spawnSub',
        invoke: (runtime) =>
          runtime.spawnSub({
            goal: 'Synthetic fixture goal',
            budget: {
              project_token_budget: 100,
              max_tokens_per_task: 50,
              max_iterations_per_mode: 1,
              max_parallel_nodes: 1,
              max_recursion_depth: 1
            },
            materials: []
          })
      },
      { method: 'papersSearch', invoke: (runtime) => runtime.papersSearch({ query: 'fixture' }) },
      {
        method: 'papersPdf',
        invoke: (runtime) => runtime.papersPdf({ doi: '10.0000/fixture.paper' })
      },
      { method: 'anythingEnsure', invoke: (runtime) => runtime.anythingEnsure() },
      {
        method: 'anythingIngest',
        invoke: (runtime) => runtime.anythingIngest({ base64: 'Zml4dHVyZQ==', name: 'fixture.pdf' })
      },
      {
        method: 'boardCreateNodes',
        invoke: (runtime) => runtime.boardCreateNodes([boardNodeFixture()])
      },
      {
        method: 'webLLMAsk',
        invoke: (runtime) => runtime.webLLMAsk({ prompt: 'Synthetic fixture prompt' })
      }
    ]

    for (const { method, invoke } of invocations) {
      const runtime = new FakeRuntime()
      await expect(invoke(runtime)).rejects.toMatchObject({
        name: 'UnexpectedFakeRuntimeCall',
        method
      })
      expect(runtime.unexpectedCalls).toHaveLength(1)
    }
  })

  it('сохраняет перехваченную неожиданную ошибку до явной очистки', async () => {
    const runtime = new FakeRuntime()

    await expect(runtime.aiChat(aiArgs('fixture::missing'))).rejects.toBeInstanceOf(
      UnexpectedFakeRuntimeCall
    )
    expect(() => runtime.verify()).toThrow('observed unexpected calls: aiChat')

    runtime.clearUnexpectedCalls()
    expect(() => runtime.verify()).not.toThrow()
  })

  it('обнаруживает неиспользованные сценарии', () => {
    const runtime = new FakeRuntime().queueAiChat(aiTextFixture('unused fixture'))

    expect(() => runtime.verify()).toThrow('unused fixtures: aiChat=1')
  })

  it('подбирает AI-ответ по matcher, сохраняет Error identity и считает usage', async () => {
    const runtime = new FakeRuntime()
    const failure = new Error('synthetic fixture failure')
    runtime.queueAiChat(
      fakeEffect(aiTextFixture('first response', 3), ({ model }) => model === 'fixture::first'),
      fakeEffect(aiTextFixture('second response', 5), ({ model }) => model === 'fixture::second'),
      fakeEffect<Parameters<Runtime['aiChat']>[0], AiChatResult>(
        failure,
        ({ model }) => model === 'fixture::failure'
      )
    )

    const [second, first] = await Promise.all([
      runtime.aiChat(aiArgs('fixture::second')),
      runtime.aiChat(aiArgs('fixture::first'))
    ])
    expect(second).toEqual(aiTextFixture('second response', 5))
    expect(first).toEqual(aiTextFixture('first response', 3))
    expect(runtime.modelUsage()).toEqual({ tokens: 8, calls: 2 })
    await expect(runtime.aiChat(aiArgs('fixture::failure'))).rejects.toBe(failure)
    expect(runtime.modelUsage()).toEqual({ tokens: 8, calls: 2 })
    expect(runtime.calls.aiChat.map(({ model }) => model)).toEqual([
      'fixture::second',
      'fixture::first',
      'fixture::failure'
    ])
    runtime.verify()
  })

  it('воспроизводит budget boundary явным ответом без копии BudgetManager', async () => {
    const runtime = new FakeRuntime().queueAiChat({
      ok: false,
      error: 'budget_exceeded'
    })

    await expect(runtime.aiChat(aiArgs('fixture::budget'))).resolves.toEqual({
      ok: false,
      error: 'budget_exceeded'
    })
    expect(runtime.modelUsage()).toEqual({ tokens: 0, calls: 1 })

    runtime.cancel('budget_exceeded')
    expect(runtime.isCancelled()).toBe(true)
    expect(runtime.cancellationReason()).toBe('budget_exceeded')
    runtime.verify()
  })

  it('не копирует production-matcher реестра, а возвращает явно заданных кандидатов', async () => {
    const runtime = new FakeRuntime()
    const scripted = [
      nodeRegistryFixture({ node_id: 'fixture-critic', type: 'critic' })
    ]
    runtime.queueCandidates(scripted)

    const result = await runtime.findCandidates({
      type: 'writer',
      capabilities: ['capability-that-does-not-match-scripted-node']
    })

    expect(result).toEqual(scripted)
    result[0].capabilities.push('mutated-return')
    expect(scripted[0].capabilities).toEqual(['fixture-capability'])
    runtime.verify()
  })

  it('сценарно обслуживает human review и spawnSub', async () => {
    const runtime = new FakeRuntime()
      .queueHuman({ decision: 'edit', feedback: 'Synthetic fixture feedback' })
      .queueSpawnSub(taskResultFixture({ task_id: 'fixture-child' }))

    await expect(
      runtime.humanRequest({
        task_id: 'fixture-task',
        reason: 'fixture review',
        best_output_key: 'fixture/output',
        best_summary: 'fixture summary'
      })
    ).resolves.toEqual({ decision: 'edit', feedback: 'Synthetic fixture feedback' })

    await expect(
      runtime.spawnSub({
        goal: 'Synthetic fixture child goal',
        budget: {
          project_token_budget: 100,
          max_tokens_per_task: 50,
          max_iterations_per_mode: 1,
          max_parallel_nodes: 1,
          max_recursion_depth: 1
        },
        materials: ['fixture/input']
      })
    ).resolves.toEqual(taskResultFixture({ task_id: 'fixture-child' }))
    runtime.verify()
  })

  it('сценарно обслуживает research, AnythingLLM, board и web LLM', async () => {
    const runtime = new FakeRuntime()
      .queuePapersSearch([paperFixture()])
      .queuePapersPdf({ ok: true, base64: 'Zml4dHVyZSBwZGY=' })
      .queueAnythingEnsure(true)
      .queueAnythingIngest({ ok: true, location: 'fixture/workspace/document' })
      .queueBoardCreateNodes(
        fakeEffect(undefined, (nodes) => nodes.length === 1 && nodes[0].kind === 'note')
      )
      .queueWebLLMAsk({ ok: true, text: 'Synthetic web fixture', provider: 'fixture-web' })
    const node = boardNodeFixture()

    await expect(runtime.papersSearch({ query: 'synthetic fixture', limit: 1 })).resolves.toEqual([
      paperFixture()
    ])
    await expect(
      runtime.papersPdf({ pdfUrl: 'https://example.invalid/papers/fixture.pdf' })
    ).resolves.toEqual({ ok: true, base64: 'Zml4dHVyZSBwZGY=' })
    await expect(runtime.anythingEnsure()).resolves.toBe(true)
    await expect(
      runtime.anythingIngest({ base64: 'Zml4dHVyZSBwZGY=', name: 'fixture.pdf' })
    ).resolves.toEqual({ ok: true, location: 'fixture/workspace/document' })
    await expect(runtime.boardCreateNodes([node])).resolves.toBeUndefined()
    await expect(
      runtime.webLLMAsk({
        prompt: 'Synthetic fixture prompt',
        target: 'fixture-target',
        provider: 'fixture-provider'
      })
    ).resolves.toEqual({
      ok: true,
      text: 'Synthetic web fixture',
      provider: 'fixture-web'
    })

    node.title = 'mutated after call'
    expect(runtime.boardNodes).toEqual([boardNodeFixture()])
    expect(runtime.calls.papersSearch).toEqual([{ query: 'synthetic fixture', limit: 1 }])
    runtime.verify()
  })
})
