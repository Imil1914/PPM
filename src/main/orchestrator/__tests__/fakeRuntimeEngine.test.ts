import { describe, expect, it } from 'vitest'

import { DEFAULT_BUDGET, type TaskNode } from '../contracts'
import type { OrchestrateOpts } from '../engine'
import { orchestrateWorkflowProfile } from '../profiles'
import { aiJsonFixture, aiTextFixture, nodeRegistryFixture } from './fakeFixtures'
import { FakeRuntime, fakeEffect } from './fakeRuntime'

const PROJECT_ID = 'm05-engine-fixture'
const INPUT_KEY = `project:${PROJECT_ID}/input:requirements`
const PLANNER_MODEL = 'fixture::planner'
const WRITER_MODEL = 'fixture::writer'
const CRITIC_MODEL = 'fixture::critic'

function options(overrides: Partial<OrchestrateOpts> = {}): OrchestrateOpts {
  return {
    goal: 'Собрать проверяемый пакет решения',
    budget: {
      ...DEFAULT_BUDGET,
      max_parallel_nodes: 2,
      max_recursion_depth: 2
    },
    depth: 1,
    materials: [INPUT_KEY],
    plannerModel: PLANNER_MODEL,
    workflowProfile: 'materials_rnd',
    ...overrides
  }
}

function plannerTasks(tasks: TaskNode[], totalTokens = 3) {
  return aiJsonFixture({ tasks }, totalTokens)
}

function canonicalTrace(runtime: FakeRuntime): unknown[] {
  return runtime.traces.map(({ duration_ms: _duration, timestamp: _timestamp, ...entry }) => entry)
}

async function runPipelineDag() {
  const runtime = new FakeRuntime({
    projectId: PROJECT_ID,
    depth: 1,
    initialVault: {
      [INPUT_KEY]: 'Исходные ограничения из памяти проекта.'
    }
  })
  const writer = nodeRegistryFixture({
    node_id: 'fixture:writer',
    capabilities: ['fixture-writing'],
    tools: [],
    model: WRITER_MODEL,
    system_prompt: 'Ты детерминированный тестовый исполнитель.',
    cost_per_call_estimate: 0,
    avg_latency_ms: 0
  })
  const t1Output = 'FIXTURE_T1_OUTPUT: сформированы исходные допущения.'
  const t2Output = 'FIXTURE_T2_OUTPUT: собран итоговый пакет.'

  runtime
    .queueAiChat(
      plannerTasks([
        {
          id: 't1',
          description: 'Сформировать допущения',
          deps: [],
          mode: 'pipeline',
          success_criteria: 'Допущения перечислены',
          size: 'small'
        },
        {
          id: 't2',
          description: 'Собрать итоговый пакет',
          deps: ['t1'],
          mode: 'pipeline',
          success_criteria: 'Пакет опирается на результат t1',
          size: 'small'
        }
      ]),
      aiTextFixture(t1Output, 5),
      aiTextFixture(t2Output, 7)
    )
    .queueCandidates([writer], [writer])

  const result = await orchestrateWorkflowProfile(runtime, options())
  runtime.verify()

  return {
    runtime,
    result,
    t1Output,
    t2Output,
    canonical: {
      result,
      vault: runtime.vaultSnapshot(),
      aiChat: runtime.calls.aiChat,
      findCandidates: runtime.calls.findCandidates,
      vaultReadMany: runtime.calls.vaultReadMany,
      vaultWrite: runtime.calls.vaultWrite,
      statuses: runtime.statuses,
      traces: canonicalTrace(runtime),
      ids: runtime.calls.newId
    }
  }
}

describe('M0.5 — FakeRuntime на реальном engine', () => {
  it('исполняет materials_rnd DAG t1 → t2 и передаёт результат зависимости через Vault', async () => {
    const first = await runPipelineDag()

    expect(first.result).toMatchObject({
      task_id: 'root',
      status: 'success',
      output_vault_key: `project:${PROJECT_ID}/task:root/output:0`,
      cost_spent: { tokens: 12, calls: 2 },
      issues: []
    })
    expect(first.runtime.calls.findCandidates).toEqual([{}, {}])
    expect(first.runtime.calls.aiChat).toHaveLength(3)

    const t2UserPrompt = first.runtime.calls.aiChat[2].messages.find(
      (message) => message.role === 'user'
    )?.content
    expect(t2UserPrompt).toContain(first.t1Output)
    expect(first.runtime.calls.vaultReadMany).toContainEqual([
      `project:${PROJECT_ID}/task:t1/node:fixture:writer/output:0`
    ])

    const rootOutput = await first.runtime.vaultRead(first.result.output_vault_key)
    expect(rootOutput).toContain('Собрать итоговый пакет')
    expect(rootOutput).toContain(first.t2Output)
    expect(first.runtime.modelUsage()).toEqual({ tokens: 15, calls: 3 })
  })

  it('повторяет один и тот же прогон с канонически идентичными результатами', async () => {
    const first = await runPipelineDag()
    const second = await runPipelineDag()

    expect(second.canonical).toEqual(first.canonical)
  })

  it('эскалирует low-score actor_critic человеку и принимает scripted approve', async () => {
    const runtime = new FakeRuntime({
      projectId: PROJECT_ID,
      depth: 1,
      initialVault: {
        [INPUT_KEY]: 'Критерии пакета для независимой оценки.'
      }
    })
    const writer = nodeRegistryFixture({
      node_id: 'fixture:writer',
      capabilities: ['fixture-writing'],
      tools: [],
      model: WRITER_MODEL,
      system_prompt: 'Ты детерминированный тестовый исполнитель.',
      cost_per_call_estimate: 0,
      avg_latency_ms: 0
    })
    const critic = nodeRegistryFixture({
      node_id: 'fixture:critic',
      type: 'critic',
      model: CRITIC_MODEL,
      capabilities: ['fixture-review'],
      system_prompt: 'Ты детерминированный тестовый критик.'
    })
    const actorOutput = 'ACTOR_OUTPUT_REQUIRING_HUMAN_APPROVAL'
    const siblingOutput = 'INDEPENDENT_SIBLING_OUTPUT'

    runtime
      .queueAiChat(
        plannerTasks([
          {
            id: 'review',
            description: 'Подготовить пакет под независимую проверку',
            deps: [],
            mode: 'actor_critic',
            success_criteria: 'Пакет соответствует rubric',
            rubric: [{ criterion: 'Проверяемость', weight: 1 }],
            size: 'small'
          },
          {
            id: 'sibling',
            description: 'Выполнить независимую ветвь',
            deps: [],
            mode: 'pipeline',
            success_criteria: 'Независимый результат сохранён',
            size: 'small'
          }
        ]),
        fakeEffect(
          aiTextFixture(actorOutput, 5),
          ({ model, messages }) =>
            model === WRITER_MODEL &&
            messages.some((message) => message.content.includes('Подготовить пакет'))
        ),
        fakeEffect(
          aiJsonFixture(
            {
              scores: [{ criterion: 'Проверяемость', score: 0.2 }],
              overall: 0.2,
              pass: false,
              feedback: 'Недостаточно доказательств'
            },
            2
          ),
          ({ model }) => model === CRITIC_MODEL
        ),
        fakeEffect(
          aiTextFixture(siblingOutput, 3),
          ({ model, messages }) =>
            model === WRITER_MODEL &&
            messages.some((message) => message.content.includes('Выполнить независимую ветвь'))
        )
      )
      .queueCandidates([writer, critic], [writer])
      .queueHuman({ decision: 'approve' })

    const result = await orchestrateWorkflowProfile(
      runtime,
      options({
        budget: {
          ...DEFAULT_BUDGET,
          max_iterations_per_mode: 1,
          max_parallel_nodes: 2,
          max_recursion_depth: 2
        }
      })
    )
    runtime.verify()

    expect(runtime.calls.humanRequest).toHaveLength(1)
    expect(runtime.calls.humanRequest[0]).toMatchObject({
      task_id: 'review',
      best_summary: actorOutput
    })
    expect(runtime.calls.humanRequest[0].reason).toContain(
      'Actor-Critic не достиг порога 0.6 за 1 итераций'
    )
    expect(result).toMatchObject({
      task_id: 'root',
      status: 'success',
      cost_spent: { tokens: 10, calls: 3 },
      issues: [expect.stringContaining('Actor-Critic не достиг порога')]
    })
    const rootOutput = await runtime.vaultRead(result.output_vault_key)
    expect(rootOutput).toContain(actorOutput)
    expect(rootOutput).toContain(siblingOutput)
    expect(runtime.statuses).toContainEqual(
      expect.objectContaining({ task_id: 'review', status: 'success', mode: 'actor_critic' })
    )
    expect(runtime.statuses).toContainEqual(
      expect.objectContaining({ task_id: 'sibling', status: 'success', mode: 'pipeline' })
    )
    expect(runtime.calls.humanRequest.every(({ task_id }) => task_id === 'review')).toBe(true)
    expect(runtime.modelUsage()).toEqual({ tokens: 13, calls: 4 })
  })
})
