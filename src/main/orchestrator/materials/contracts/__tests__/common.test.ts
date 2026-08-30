import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  ActorRefSchema,
  ArtifactKindSchema,
  EntityIdSchema,
  IntervalQuantitySchema,
  IsoDateTimeSchema,
  MaterialsProjectStatusSchema,
  ProvenanceRefSchema,
  QuantitySchema,
  RouteFamilySchema,
  SourceLocatorSchema,
  StructuredFailureV1Schema,
  VersionRefSchema,
  type Quantity,
  type VersionRef
} from '../common'

describe('materials contract common primitives', () => {
  it('выводит типы из Zod-схем', () => {
    expectTypeOf<Quantity>().toEqualTypeOf<{ value: number; unit: string }>()
    expectTypeOf<VersionRef>().toEqualTypeOf<{
      entity_type: string
      entity_id: string
      version: number
    }>()
  })

  it('принимает нормативные примитивы и enum', () => {
    expect(EntityIdSchema.parse('goal:al-plate/1')).toBe('goal:al-plate/1')
    expect(IsoDateTimeSchema.parse('2026-08-28T10:20:30.123Z')).toContain('Z')
    expect(
      ActorRefSchema.parse({ kind: 'engineer', id: 'engineer:fixture' })
    ).toEqual({ kind: 'engineer', id: 'engineer:fixture' })
    expect(
      VersionRefSchema.parse({ entity_type: 'ResearchGoalV1', entity_id: 'goal:1', version: 1 })
    ).toMatchObject({ version: 1 })
    expect(MaterialsProjectStatusSchema.options).toHaveLength(13)
    expect(RouteFamilySchema.parse('forging')).toBe('forging')
    expect(ArtifactKindSchema.parse('flow_board')).toBe('flow_board')
  })

  it('принимает величины, интервалы и точный provenance locator', () => {
    expect(QuantitySchema.parse({ value: 200, unit: 'degC' })).toEqual({
      value: 200,
      unit: 'degC'
    })
    expect(IntervalQuantitySchema.parse({ min: 100, target: 150, max: 200, unit: 'MPa' })).toMatchObject({
      target: 150
    })
    expect(
      ProvenanceRefSchema.parse({
        source_id: 'source:01',
        source_version: 1,
        fragment_id: 'fragment:01',
        locator: { page: 3, table: 'Table 2', cell_range: 'B4:C4', char_start: 10, char_end: 30 }
      })
    ).toMatchObject({ source_version: 1 })
  })

  it.each([
    ['', EntityIdSchema],
    [' id-with-space ', EntityIdSchema],
    ['id with space', EntityIdSchema],
    ['2026-08-28T13:20:30+03:00', IsoDateTimeSchema],
    [{ entity_type: 'Goal', entity_id: 'goal:1', version: 0 }, VersionRefSchema],
    [{ value: Number.NaN, unit: 'MPa' }, QuantitySchema],
    [{ value: Number.POSITIVE_INFINITY, unit: 'MPa' }, QuantitySchema],
    [{ value: 10, unit: '' }, QuantitySchema],
    [{ unit: 'MPa' }, IntervalQuantitySchema],
    [{ min: 20, max: 10, unit: 'MPa' }, IntervalQuantitySchema],
    [{ char_start: 5, char_end: 4 }, SourceLocatorSchema],
    [{}, SourceLocatorSchema]
  ])('отклоняет небезопасный или неполный примитив %#', (value, schema) => {
    expect(schema.safeParse(value).success).toBe(false)
  })

  it('отклоняет неизвестные enum и лишние поля', () => {
    expect(MaterialsProjectStatusSchema.safeParse('paused')).toMatchObject({ success: false })
    expect(RouteFamilySchema.safeParse('extrusion')).toMatchObject({ success: false })
    expect(
      QuantitySchema.safeParse({ value: 1, unit: 'kg', hidden: true })
    ).toMatchObject({ success: false })
  })

  it('проверяет структурированную ошибку без произвольных полей', () => {
    const failure = {
      code: 'TOOL_TIMEOUT',
      category: 'timeout' as const,
      message: 'Fixture timeout',
      retryable: true,
      details: { attempt: 2 },
      caused_by_ref: { entity_type: 'ToolInvocationV1', entity_id: 'tool-call:1', version: 1 }
    }
    expect(StructuredFailureV1Schema.parse(failure)).toEqual(failure)
    expect(StructuredFailureV1Schema.safeParse({ ...failure, stack: 'secret' }).success).toBe(false)
  })
})
