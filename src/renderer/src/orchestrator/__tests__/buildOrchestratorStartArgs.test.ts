import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { buildOrchestratorStartArgs } from '../buildOrchestratorStartArgs'

const baseDraft = {
  goal: 'Проверить маршрут',
  model: 'test-model',
  materials: 'контекст',
  budget: {
    project_token_budget: 1_000,
    max_parallel_nodes: 2
  }
}

describe('buildOrchestratorStartArgs', () => {
  it.each([undefined, null])('назначает generic старой ноде без профиля: %s', (workflowProfile) => {
    expect(buildOrchestratorStartArgs({ ...baseDraft, workflowProfile })).toEqual({
      ...baseDraft,
      workflowProfile: 'generic'
    })
  })

  it.each(['generic', 'materials_rnd'] as const)('передаёт профиль %s без изменения', (workflowProfile) => {
    expect(buildOrchestratorStartArgs({ ...baseDraft, workflowProfile })).toEqual({
      ...baseDraft,
      workflowProfile
    })
  })

  it.each(['materials', 'GENERIC', '', 'materials_rnd ', 42, {}])(
    'не превращает повреждённое значение %p в generic',
    (workflowProfile) => {
      expect(() => buildOrchestratorStartArgs({ ...baseDraft, workflowProfile })).toThrow(ZodError)
    }
  )
})
