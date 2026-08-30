import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import * as contractExports from '../index'
import {
  MATERIALS_JSON_SCHEMA_DIALECT,
  MATERIALS_JSON_SCHEMA_OPTIONS,
  type MaterialsV1ContractName,
  canonicalizeMaterialsJson,
  generateMaterialsV1JsonSchema,
  generateMaterialsV1JsonSchemaCatalog,
  getMaterialsV1ContractSchema,
  materialsV1ContractNames,
  materialsV1ContractRegistry,
  serializeMaterialsV1JsonSchemaCatalog
} from '../jsonSchema'
import {
  clone,
  contractCases,
  removeOptionalRootFields,
  requiredRootFields,
  wrongTypeFor
} from './contractCompletenessCases'

type JsonObject = Record<string, unknown>

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requireJsonObject = (value: unknown, label: string): JsonObject => {
  if (!isJsonObject(value)) {
    throw new TypeError(`${label} must be a JSON object`)
  }
  return value
}

const valueAt = (value: unknown, label: string, ...path: string[]): unknown => {
  let current = value
  for (const segment of path) {
    current = requireJsonObject(current, label)[segment]
  }
  return current
}

const walkJson = (
  value: unknown,
  visit: (object: JsonObject, path: readonly string[]) => void,
  path: readonly string[] = []
): void => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkJson(item, visit, [...path, String(index)]))
    return
  }

  if (!isJsonObject(value)) return

  visit(value, path)
  for (const [key, child] of Object.entries(value)) {
    walkJson(child, visit, [...path, key])
  }
}

const exportedV1SchemaEntries = Object.entries(contractExports)
  .filter(
    ([name, value]) =>
      name.endsWith('V1Schema') &&
      typeof value === 'object' &&
      value !== null &&
      'safeParse' in value
  )
  .sort(([left], [right]) => left.localeCompare(right))

const contractNameFromSchemaExport = (exportName: string): MaterialsV1ContractName =>
  exportName.slice(0, -'Schema'.length) as MaterialsV1ContractName

const contractNameFromCase = (caseName: string): MaterialsV1ContractName =>
  contractNameFromSchemaExport(caseName)

const roundTripValidators = new Map<MaterialsV1ContractName, z.ZodType>()

const getRoundTripValidator = (name: MaterialsV1ContractName): z.ZodType => {
  const cached = roundTripValidators.get(name)
  if (cached) return cached

  const serialized = JSON.stringify(generateMaterialsV1JsonSchema(name))
  const validator = z.fromJSONSchema(JSON.parse(serialized))
  roundTripValidators.set(name, validator)
  return validator
}

describe('materials V1 JSON Schema registry completeness', () => {
  it('keeps the 44 public exports, source identities, fixture cases, and catalog exact', () => {
    const catalog = generateMaterialsV1JsonSchemaCatalog()
    const exportedNames = exportedV1SchemaEntries.map(([name]) =>
      contractNameFromSchemaExport(name)
    )
    const fixtureNames = contractCases
      .map(({ name }) => contractNameFromCase(name))
      .sort()
    const registryNames = Object.keys(materialsV1ContractRegistry).sort()
    const catalogNames = Object.keys(catalog).sort()

    expect(exportedV1SchemaEntries).toHaveLength(44)
    expect(contractCases).toHaveLength(44)
    expect(materialsV1ContractNames).toHaveLength(44)
    expect(exportedNames).toEqual(registryNames)
    expect(fixtureNames).toEqual(registryNames)
    expect(catalogNames).toEqual(registryNames)
    expect(registryNames).not.toContain('createAgentResultV1')

    const casesByName = new Map(
      contractCases.map((testCase) => [contractNameFromCase(testCase.name), testCase])
    )
    for (const [exportName, sourceSchema] of exportedV1SchemaEntries) {
      const contractName = contractNameFromSchemaExport(exportName)
      expect(materialsV1ContractRegistry[contractName]).toBe(sourceSchema)
      expect(getMaterialsV1ContractSchema(contractName)).toBe(sourceSchema)
      expect(casesByName.get(contractName)?.schema).toBe(sourceSchema)
    }

    expect(new Set(Object.values(materialsV1ContractRegistry))).toHaveLength(44)
  })

  it('publishes sorted unique names and the exact fail-closed generator options', () => {
    const sortedNames = [...materialsV1ContractNames].sort()

    expect(materialsV1ContractNames).toEqual(sortedNames)
    expect(new Set(materialsV1ContractNames)).toHaveLength(44)
    expect(Object.isFrozen(materialsV1ContractNames)).toBe(true)
    expect(Object.isFrozen(materialsV1ContractRegistry)).toBe(true)
    expect(Object.isFrozen(MATERIALS_JSON_SCHEMA_OPTIONS)).toBe(true)
    expect(MATERIALS_JSON_SCHEMA_OPTIONS).toEqual({
      target: 'draft-2020-12',
      io: 'input',
      unrepresentable: 'throw',
      cycles: 'throw',
      reused: 'inline'
    })
  })
})

describe('materials V1 JSON Schema catalog', () => {
  it('is canonical, deterministic, JSON-serializable, and byte-stable', () => {
    const firstCatalog = generateMaterialsV1JsonSchemaCatalog()
    const secondCatalog = generateMaterialsV1JsonSchemaCatalog()
    const first = serializeMaterialsV1JsonSchemaCatalog(firstCatalog)
    const second = serializeMaterialsV1JsonSchemaCatalog(secondCatalog)

    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true)
    expect(JSON.parse(first)).toEqual(firstCatalog)
    expect(JSON.parse(JSON.stringify(firstCatalog))).toEqual(firstCatalog)

    walkJson(firstCatalog, (object, path) => {
      const keys = Object.keys(object)
      expect(keys, `Non-canonical key order at ${path.join('.') || '<catalog>'}`).toEqual(
        [...keys].sort()
      )
    })
  })

  it('preserves special JSON keys and rejects values that JSON.stringify would corrupt', () => {
    const specialKeyInput = JSON.parse('{"__proto__":{"safe":true},"z":1,"a":2}')
    const canonical = canonicalizeMaterialsJson(specialKeyInput)

    expect(Object.keys(canonical as JsonObject)).toEqual(['__proto__', 'a', 'z'])
    expect(JSON.parse(JSON.stringify(canonical))).toEqual(specialKeyInput)
    expect(Object.getPrototypeOf(canonical)).toBe(Object.prototype)

    expect(() => canonicalizeMaterialsJson({ invalid: Number.NaN })).toThrow(
      'non-finite number'
    )
    expect(() => canonicalizeMaterialsJson({ invalid: undefined })).toThrow(
      'not JSON-serializable'
    )

    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => canonicalizeMaterialsJson(cyclic)).toThrow('cycle')
  })

  it('matches the committed generated catalog snapshot', async () => {
    await expect(serializeMaterialsV1JsonSchemaCatalog()).toMatchFileSnapshot(
      './__snapshots__/materials-v1-json-schema.catalog.json'
    )
  })

  it('uses Draft 2020-12 and contains no unstable or non-portable generator artifacts', () => {
    const catalog = generateMaterialsV1JsonSchemaCatalog()
    const forbiddenKeys = new Set(['$id', '__shared', 'definitions', '~standard'])

    for (const [name, schema] of Object.entries(catalog)) {
      expect(schema.$schema, name).toBe(MATERIALS_JSON_SCHEMA_DIALECT)
    }

    walkJson(catalog, (object, path) => {
      for (const key of Object.keys(object)) {
        expect(
          forbiddenKeys.has(key),
          `Forbidden key ${key} at ${[...path, key].join('.')}`
        ).toBe(false)
      }
    })

    const serialized = serializeMaterialsV1JsonSchemaCatalog()
    expect(serialized).not.toContain('__shared')
    expect(serialized).not.toMatch(/__schema\d+/)
  })

  it('preserves schema_version literals wherever the source contract declares one', () => {
    const catalog = generateMaterialsV1JsonSchemaCatalog()
    let versionedContracts = 0

    for (const testCase of contractCases) {
      if (!Object.hasOwn(testCase.fullFixture, 'schema_version')) continue

      versionedContracts += 1
      const name = contractNameFromCase(testCase.name)
      const versionProperty = requireJsonObject(
        valueAt(catalog[name], name, 'properties', 'schema_version'),
        `${name}.properties.schema_version`
      )
      expect(versionProperty.const, name).toBe(testCase.fullFixture.schema_version)
    }

    expect(versionedContracts).toBeGreaterThan(0)
  })

  it('preserves strict objects, records, unknown payloads, enums, UTC, required, and bounds', () => {
    const catalog = generateMaterialsV1JsonSchemaCatalog()
    const researchGoal = catalog.ResearchGoalV1
    const product = requireJsonObject(
      valueAt(researchGoal, 'ResearchGoalV1', 'properties', 'product'),
      'ResearchGoalV1.properties.product'
    )
    const geometry = requireJsonObject(
      valueAt(product, 'ResearchGoalV1.product', 'properties', 'geometry'),
      'ResearchGoalV1.product.geometry'
    )
    const geometryValues = requireJsonObject(
      geometry.additionalProperties,
      'ResearchGoalV1.product.geometry.additionalProperties'
    )
    const priorityWeights = requireJsonObject(
      valueAt(
        researchGoal,
        'ResearchGoalV1',
        'properties',
        'business_constraints',
        'properties',
        'priority_weights'
      ),
      'ResearchGoalV1.business_constraints.priority_weights'
    )
    const toolKind = requireJsonObject(
      valueAt(catalog.ToolSpecV1, 'ToolSpecV1', 'properties', 'kind'),
      'ToolSpecV1.properties.kind'
    )
    const ingestedAt = requireJsonObject(
      valueAt(catalog.SourceDocumentV1, 'SourceDocumentV1', 'properties', 'ingested_at'),
      'SourceDocumentV1.properties.ingested_at'
    )
    const ttl = requireJsonObject(
      valueAt(
        catalog.AgentSpecV1,
        'AgentSpecV1',
        'properties',
        'limits',
        'properties',
        'ttl_ms'
      ),
      'AgentSpecV1.limits.ttl_ms'
    )
    const fraction = requireJsonObject(
      valueAt(
        catalog.MaterialCompositionV1,
        'MaterialCompositionV1',
        'properties',
        'components',
        'items',
        'properties',
        'fraction'
      ),
      'MaterialCompositionV1.components.items.fraction'
    )
    const targetProperties = requireJsonObject(
      valueAt(researchGoal, 'ResearchGoalV1', 'properties', 'target_properties'),
      'ResearchGoalV1.properties.target_properties'
    )
    const sourceRequired = valueAt(catalog.SourceDocumentV1, 'SourceDocumentV1', 'required')

    expect(researchGoal.additionalProperties).toBe(false)
    expect(product.additionalProperties).toBe(false)
    expect(geometry.propertyNames).toEqual({ minLength: 1, type: 'string' })
    expect(geometryValues.additionalProperties).toBe(false)
    expect(priorityWeights.propertyNames).toEqual({ minLength: 1, type: 'string' })
    expect(priorityWeights.additionalProperties).toEqual({ minimum: 0, type: 'number' })
    expect(valueAt(catalog.AgentResultV1, 'AgentResultV1', 'properties', 'output')).toEqual(
      {}
    )
    expect(toolKind.enum).toEqual([
      'local_function',
      'sidecar',
      'external_api',
      'model',
      'artifact_generator'
    ])
    expect(ingestedAt.format).toBe('date-time')
    expect(ingestedAt.pattern).toEqual(expect.stringContaining('Z'))
    expect(sourceRequired).toEqual(expect.arrayContaining(['schema_version', 'id', 'ingested_at']))
    expect(sourceRequired).not.toContain('doi')
    expect(ttl).toMatchObject({ type: 'integer', exclusiveMinimum: 0 })
    expect(fraction).toMatchObject({ type: 'number', minimum: 0, maximum: 1 })
    expect(targetProperties).toMatchObject({ type: 'array', minItems: 1 })

    const sourceCase = contractCases.find(({ name }) => name === 'SourceDocumentV1Schema')
    if (!sourceCase) throw new Error('SourceDocumentV1 fixture is missing')
    const nonUtc = clone(sourceCase.fullFixture)
    nonUtc.ingested_at = '2026-08-28T12:00:00+03:00'
    expect(getRoundTripValidator('SourceDocumentV1').safeParse(nonUtc).success).toBe(false)
  })
})

describe('materials V1 JSON Schema structural round-trip', () => {
  it.each(contractCases)(
    '$name accepts full and minimal fixtures in source Zod and round-trip validators',
    (testCase) => {
      const name = contractNameFromCase(testCase.name)
      const roundTrip = getRoundTripValidator(name)
      const minimal = removeOptionalRootFields(testCase)

      expect(testCase.schema.safeParse(testCase.fullFixture).success).toBe(true)
      expect(roundTrip.safeParse(testCase.fullFixture).success).toBe(true)
      expect(testCase.schema.safeParse(minimal).success).toBe(true)
      expect(roundTrip.safeParse(minimal).success).toBe(true)
    }
  )

  it.each(contractCases)(
    '$name rejects every missing required root field in source and round-trip validators',
    (testCase) => {
      const roundTrip = getRoundTripValidator(contractNameFromCase(testCase.name))

      for (const field of requiredRootFields(testCase)) {
        const invalid = clone(testCase.fullFixture)
        delete invalid[field]

        expect(
          testCase.schema.safeParse(invalid).success,
          `${testCase.name}.${field} source Zod accepted a missing required field`
        ).toBe(false)
        expect(
          roundTrip.safeParse(invalid).success,
          `${testCase.name}.${field} round-trip accepted a missing required field`
        ).toBe(false)
      }
    }
  )

  it.each(contractCases)(
    '$name rejects wrong JSON types for every typed required root field',
    (testCase) => {
      const roundTrip = getRoundTripValidator(contractNameFromCase(testCase.name))
      const arbitraryFields = new Set(testCase.arbitraryUnknownRootFields ?? [])

      for (const field of requiredRootFields(testCase)) {
        if (arbitraryFields.has(field)) continue

        const invalid = clone(testCase.fullFixture)
        invalid[field] = wrongTypeFor(testCase.fullFixture[field])

        expect(
          testCase.schema.safeParse(invalid).success,
          `${testCase.name}.${field} source Zod accepted a wrong JSON type`
        ).toBe(false)
        expect(
          roundTrip.safeParse(invalid).success,
          `${testCase.name}.${field} round-trip accepted a wrong JSON type`
        ).toBe(false)
      }
    }
  )

  it.each(contractCases)(
    '$name rejects an extra root field in source and round-trip validators',
    (testCase) => {
      const invalid = clone(testCase.fullFixture)
      invalid.fixture_unexpected_root_field = true
      const roundTrip = getRoundTripValidator(contractNameFromCase(testCase.name))

      expect(testCase.schema.safeParse(invalid).success).toBe(false)
      expect(roundTrip.safeParse(invalid).success).toBe(false)
    }
  )

  it('proves that reported_fact evidence remains a source-Zod-only custom refinement', () => {
    const testCase = contractCases.find(({ name }) => name === 'ClaimProposalV1Schema')
    if (!testCase) throw new Error('ClaimProposalV1 fixture is missing')

    const missingEvidence = clone(testCase.fullFixture)
    missingEvidence.evidence_refs = []

    expect(missingEvidence.claim_type).toBe('reported_fact')
    expect(testCase.schema.safeParse(missingEvidence).success).toBe(false)
    expect(getRoundTripValidator('ClaimProposalV1').safeParse(missingEvidence).success).toBe(
      true
    )
  })
})
