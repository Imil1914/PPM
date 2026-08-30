import { describe, expect, it } from 'vitest'
import * as contractExports from '../index'
import {
  clone,
  contractCases,
  removeOptionalRootFields,
  requiredRootFields,
  wrongTypeFor
} from './contractCompletenessCases'

describe('contractCompleteness exported V1 contract matrix', () => {
  it('has an explicit fixture case for every exported V1 Zod schema', () => {
    const exportedV1Schemas = Object.entries(contractExports)
      .filter(
        ([name, value]) =>
          name.endsWith('V1Schema') &&
          typeof value === 'object' &&
          value !== null &&
          'safeParse' in value
      )
      .map(([name]) => name)
      .sort()

    expect(contractCases.map(({ name }) => name).sort()).toEqual(exportedV1Schemas)
  })

  it.each(contractCases)('$name parses its full fixture', ({ schema, fullFixture }) => {
    expect(schema.safeParse(fullFixture).success).toBe(true)
  })

  it.each(contractCases)(
    '$name parses after all optional root fields are removed',
    (testCase) => {
      expect(testCase.schema.safeParse(removeOptionalRootFields(testCase)).success).toBe(true)
    }
  )

  it.each(contractCases)(
    '$name rejects removal of every required root field',
    (testCase) => {
      for (const field of requiredRootFields(testCase)) {
        const invalid = clone(testCase.fullFixture)
        delete invalid[field]
        expect(
          testCase.schema.safeParse(invalid).success,
          `${testCase.name}.${field} unexpectedly accepted a missing required field`
        ).toBe(false)
      }
    }
  )

  it.each(contractCases)(
    '$name rejects null and wrong types for every typed required root field',
    (testCase) => {
      const arbitraryFields = new Set(testCase.arbitraryUnknownRootFields ?? [])
      for (const field of requiredRootFields(testCase)) {
        if (arbitraryFields.has(field)) continue

        const nullValue = clone(testCase.fullFixture)
        nullValue[field] = null
        expect(
          testCase.schema.safeParse(nullValue).success,
          `${testCase.name}.${field} unexpectedly accepted null`
        ).toBe(false)

        const wrongType = clone(testCase.fullFixture)
        wrongType[field] = wrongTypeFor(testCase.fullFixture[field])
        expect(
          testCase.schema.safeParse(wrongType).success,
          `${testCase.name}.${field} unexpectedly accepted a wrong type`
        ).toBe(false)
      }
    }
  )
})
