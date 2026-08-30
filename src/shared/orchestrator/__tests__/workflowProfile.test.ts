import { describe, expect, expectTypeOf, it } from 'vitest'
import { ZodError } from 'zod'
import {
  DEFAULT_WORKFLOW_PROFILE,
  WorkflowProfileSchema,
  parseWorkflowProfile,
  type WorkflowProfile
} from '../workflowProfile'

describe('WorkflowProfile', () => {
  it('выводит TypeScript-тип из Zod-схемы', () => {
    expectTypeOf<WorkflowProfile>().toEqualTypeOf<'generic' | 'materials_rnd'>()
  })

  it('содержит ровно два допустимых профиля', () => {
    expect(WorkflowProfileSchema.options).toEqual(['generic', 'materials_rnd'])
    expect(DEFAULT_WORKFLOW_PROFILE).toBe('generic')
  })

  it.each(['generic', 'materials_rnd'] as const)('принимает профиль %s', (profile) => {
    expect(parseWorkflowProfile(profile)).toBe(profile)
  })

  it.each([undefined, null])('использует generic только при отсутствии значения: %s', (value) => {
    expect(parseWorkflowProfile(value)).toBe(DEFAULT_WORKFLOW_PROFILE)
  })

  it.each([undefined, null])('оставляет саму enum-схему строгой для значения: %s', (value) => {
    expect(WorkflowProfileSchema.safeParse(value).success).toBe(false)
  })

  const invalidProfiles: unknown[] = ['materials', 'GENERIC', ' generic ', 123, {}, [], '', false, true]

  it.each(invalidProfiles)('отклоняет неизвестное значение стандартной ошибкой Zod: %p', (value) => {
    expect(() => parseWorkflowProfile(value)).toThrow(ZodError)
  })
})
