import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyDatabaseMigrations } from '../../../../db/migrations'
import { ResearchGoalV1Schema, type ActorRef, type VersionRef } from '../../contracts'
import {
  canonicalizeMaterialsJson,
  materialsV1ContractNames,
  type MaterialsV1ContractName
} from '../../contracts/jsonSchema'
import {
  clone,
  contractCases,
  type ContractCompletenessCase,
  type FixtureObject
} from '../../contracts/__tests__/contractCompletenessCases'
import {
  createMaterialsVersionRepository,
  MaterialsVersionRepositoryError
} from '../versionRepository'

const NOW = '2026-08-28T14:00:00.000Z'
const PROJECT_A = 'project-repository-a'
const PROJECT_B = 'project-repository-b'
const ACTOR: ActorRef = { kind: 'engineer', id: 'engineer-repository-test' }

type TestEnvelope = Readonly<{
  record_id: string
  project_id: string
  schema_version: MaterialsV1ContractName
  id: string
  version: number
  payload: Readonly<Record<string, unknown>>
  payload_sha256: string
  supersedes_ref: VersionRef | null
  created_at: string
  created_by: ActorRef
}>

type TestCreateInput = {
  projectId: string
  contractId: MaterialsV1ContractName
  entityId: string
  payload: unknown
  createdBy: ActorRef
  createdAt?: string
}

type TestRepository = {
  create(input: TestCreateInput): TestEnvelope
  read(input: { projectId: string; ref: VersionRef }): TestEnvelope
  list(input: {
    projectId: string
    contractId: MaterialsV1ContractName
    entityId: string
    beforeVersion?: number
    limit?: number
  }): Readonly<{ items: readonly TestEnvelope[]; nextBeforeVersion: number | null }>
  supersede(input: {
    projectId: string
    ref: VersionRef
    payload: unknown
    createdBy: ActorRef
    createdAt?: string
    expectedPayloadSha256?: string
  }): TestEnvelope
}

type RawVersion = {
  recordId: string
  projectId?: string
  contractId?: string
  entityId?: string
  revision?: number | bigint
  payloadJson?: string
  payloadSha256?: string
  supersedesRecordId?: string | null
  createdAt?: string
  createdBy?: ActorRef
}

let temporaryRoot = ''
let databaseSequence = 0
const openDatabases = new Set<DatabaseSync>()

beforeEach(() => {
  temporaryRoot = mkdtempSync(join(tmpdir(), 'antyflow-version-repository-'))
  databaseSequence = 0
})

afterEach(() => {
  for (const database of openDatabases) {
    try {
      database.close()
    } catch {
      // A failed assertion may have already closed the database.
    }
  }
  openDatabases.clear()
  rmSync(temporaryRoot, { recursive: true, force: true })
})

function openDatabase(name = `repository-${databaseSequence++}.db`): DatabaseSync {
  const database = new DatabaseSync(join(temporaryRoot, name))
  database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 1000;')
  applyDatabaseMigrations(database)
  openDatabases.add(database)
  return database
}

function openExistingDatabase(name: string): DatabaseSync {
  const database = new DatabaseSync(join(temporaryRoot, name))
  database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 1000;')
  openDatabases.add(database)
  return database
}

function closeDatabase(database: DatabaseSync): void {
  database.close()
  openDatabases.delete(database)
}

function insertProject(database: DatabaseSync, projectId: string): void {
  database
    .prepare(
      `INSERT INTO materials_projects (
         project_id, board_id, workflow_profile, status,
         created_at, updated_at, created_by_kind, created_by_id
       ) VALUES (?, ?, 'materials_rnd', 'draft', ?, ?, ?, ?)`
    )
    .run(projectId, `${projectId}-board`, NOW, NOW, ACTOR.kind, ACTOR.id)
}

function createRepository(
  database: DatabaseSync,
  options: { ids?: readonly string[]; now?: string } = {}
): TestRepository {
  const ids = [...(options.ids ?? [])]
  let generated = 0
  return createMaterialsVersionRepository(database, {
    now: () => options.now ?? NOW,
    generateRecordId: () => ids.shift() ?? `record-${++generated}`
  }) as unknown as TestRepository
}

function contractIdFor(testCase: ContractCompletenessCase): MaterialsV1ContractName {
  return testCase.name.replace(/Schema$/, '') as MaterialsV1ContractName
}

function contractCase(contractId: MaterialsV1ContractName): ContractCompletenessCase {
  const found = contractCases.find((testCase) => contractIdFor(testCase) === contractId)
  if (!found) throw new Error(`Missing fixture for ${contractId}`)
  return found
}

function payloadFor(
  contractId: MaterialsV1ContractName,
  entityId: string,
  revision: number,
  options: {
    projectId?: string
    createdAt?: string
    createdBy?: ActorRef
    superseding?: boolean
  } = {}
): FixtureObject {
  const payload = clone(contractCase(contractId).fullFixture)
  const projectId = options.projectId ?? PROJECT_A
  const createdAt = options.createdAt ?? NOW
  const createdBy = options.createdBy ?? ACTOR

  if (Object.hasOwn(payload, 'schema_version')) payload.schema_version = contractId
  if (Object.hasOwn(payload, 'id')) payload.id = entityId
  if (Object.hasOwn(payload, 'version')) payload.version = revision
  if (Object.hasOwn(payload, 'project_id')) payload.project_id = projectId
  if (Object.hasOwn(payload, 'created_at')) payload.created_at = createdAt
  if (Object.hasOwn(payload, 'created_by')) payload.created_by = structuredClone(createdBy)
  if (Object.hasOwn(payload, 'supersedes_id')) {
    if (options.superseding) payload.supersedes_id = entityId
    else delete payload.supersedes_id
  }
  return payload
}

function refFor(
  contractId: MaterialsV1ContractName,
  entityId: string,
  version: number
): VersionRef {
  return { entity_type: contractId, entity_id: entityId, version }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalizeMaterialsJson(value))
}

function insertRawVersion(database: DatabaseSync, input: RawVersion): void {
  const payloadJson = input.payloadJson ?? '{}'
  const actor = input.createdBy ?? ACTOR
  database
    .prepare(
      `INSERT INTO materials_object_versions (
         record_id, project_id, contract_id, entity_id, entity_revision,
         payload_json, payload_sha256, supersedes_record_id,
         created_at, created_by_kind, created_by_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.recordId,
      input.projectId ?? PROJECT_A,
      input.contractId ?? 'ResearchGoalV1',
      input.entityId ?? 'raw-entity',
      input.revision ?? 1,
      payloadJson,
      input.payloadSha256 ?? sha256(payloadJson),
      input.supersedesRecordId ?? null,
      input.createdAt ?? NOW,
      actor.kind,
      actor.id
    )
}

function rowCount(database: DatabaseSync): number {
  const row = database.prepare('SELECT COUNT(*) AS count FROM materials_object_versions').get()
  return Number(row?.count)
}

function storedBytes(database: DatabaseSync, recordId: string): Record<string, unknown> {
  const row = database
    .prepare(
      `SELECT record_id, project_id, contract_id, entity_id, entity_revision,
              payload_json, payload_sha256, supersedes_record_id,
              created_at, created_by_kind, created_by_id
         FROM materials_object_versions
        WHERE record_id = ?`
    )
    .get(recordId)
  if (!row) throw new Error(`Missing stored row ${recordId}`)
  return { ...row }
}

function expectRepositoryError(
  action: () => unknown,
  code: InstanceType<typeof MaterialsVersionRepositoryError>['code']
): MaterialsVersionRepositoryError {
  let caught: unknown
  try {
    action()
  } catch (error) {
    caught = error
  }

  expect(caught).toBeInstanceOf(MaterialsVersionRepositoryError)
  expect(caught).toMatchObject({ code })
  return caught as MaterialsVersionRepositoryError
}

describe('MaterialsVersionRepository contract manifest', () => {
  it('creates and exact-reads every one of the 44 registry contracts', () => {
    const database = openDatabase()
    insertProject(database, PROJECT_A)
    const repository = createRepository(database)
    const fixtureNames = contractCases.map(contractIdFor).sort()

    expect(materialsV1ContractNames).toHaveLength(44)
    expect(fixtureNames).toEqual([...materialsV1ContractNames])
    expect(
      contractCases.filter((testCase) => Object.hasOwn(testCase.fullFixture, 'schema_version'))
    ).toHaveLength(31)

    for (const contractId of materialsV1ContractNames) {
      const entityId = `matrix-${contractId}`
      const payload = payloadFor(contractId, entityId, 1)
      const created = repository.create({
        projectId: PROJECT_A,
        contractId,
        entityId,
        payload,
        createdBy: ACTOR
      })
      const read = repository.read({
        projectId: PROJECT_A,
        ref: refFor(contractId, entityId, 1)
      })

      expect(created, contractId).toMatchObject({
        project_id: PROJECT_A,
        schema_version: contractId,
        id: entityId,
        version: 1,
        supersedes_ref: null,
        created_at: NOW,
        created_by: ACTOR
      })
      expect(read, contractId).toEqual(created)
      expect(read.payload, contractId).toEqual(payload)
      expect(read.payload_sha256, contractId).toMatch(/^[0-9a-f]{64}$/)
    }

    expect(rowCount(database)).toBe(44)
  })
})

describe('create and read boundaries', () => {
  it('accepts an explicit envelope timestamp with the default production clock protocol', () => {
    const database = openDatabase()
    insertProject(database, PROJECT_A)
    const ids = ['explicit-time-record-1', 'explicit-time-record-2']
    const repository = createMaterialsVersionRepository(database, {
      generateRecordId: () => ids.shift() ?? 'unexpected-explicit-time-record'
    })
    const first = repository.create({
      projectId: PROJECT_A,
      contractId: 'ResearchGoalV1',
      entityId: 'explicit-time-goal',
      payload: ResearchGoalV1Schema.parse(
        payloadFor('ResearchGoalV1', 'explicit-time-goal', 1, {
          createdAt: NOW
        })
      ),
      createdBy: ACTOR,
      createdAt: NOW
    })
    const second = repository.supersede({
      projectId: PROJECT_A,
      ref: refFor('ResearchGoalV1', 'explicit-time-goal', 1) as VersionRef & {
        entity_type: 'ResearchGoalV1'
      },
      payload: ResearchGoalV1Schema.parse(
        payloadFor('ResearchGoalV1', 'explicit-time-goal', 2, {
          createdAt: NOW,
          superseding: true
        })
      ),
      createdBy: ACTOR,
      createdAt: NOW
    })

    expect(first.created_at).toBe(NOW)
    expect(second.created_at).toBe(NOW)
    expect(second.version).toBe(2)
  })

  it('stores compact canonical JSON, hashes its exact UTF-8 bytes and normalizes JSON round-trip values', () => {
    const database = openDatabase()
    insertProject(database, PROJECT_A)
    const repository = createRepository(database, { ids: ['canonical-record'] })
    const payload = payloadFor('AgentResultV1', 'canonical-result', 1)
    payload.output = { zebra: -0, alpha: { second: 2, first: 1 } }

    const created = repository.create({
      projectId: PROJECT_A,
      contractId: 'AgentResultV1',
      entityId: 'canonical-result',
      payload,
      createdBy: ACTOR
    })
    const row = storedBytes(database, 'canonical-record')
    const payloadJson = String(row.payload_json)

    expect(JSON.stringify(JSON.parse(payloadJson))).toBe(payloadJson)
    expect(payloadJson.indexOf('"alpha"')).toBeLessThan(payloadJson.indexOf('"zebra"'))
    expect(row.payload_sha256).toBe(sha256(payloadJson))
    expect(created.payload_sha256).toBe(sha256(payloadJson))
    expect((created.payload.output as { zebra: number }).zebra).toBe(0)
    expect(Object.is((created.payload.output as { zebra: number }).zebra, -0)).toBe(false)
    expect(repository.read({
      projectId: PROJECT_A,
      ref: refFor('AgentResultV1', 'canonical-result', 1)
    })).toEqual(created)
  })

  it('rejects unknown contracts, invalid shapes and custom refinements without inserting', () => {
    const database = openDatabase()
    insertProject(database, PROJECT_A)
    const repository = createRepository(database)

    expectRepositoryError(
      () =>
        repository.create({
          projectId: PROJECT_A,
          contractId: 'UnknownContractV1' as MaterialsV1ContractName,
          entityId: 'unknown-contract',
          payload: {},
          createdBy: ACTOR
        }),
      'UNKNOWN_CONTRACT'
    )

    const invalidShape = payloadFor('ResearchGoalV1', 'invalid-shape', 1)
    delete invalidShape.title
    expectRepositoryError(
      () =>
        repository.create({
          projectId: PROJECT_A,
          contractId: 'ResearchGoalV1',
          entityId: 'invalid-shape',
          payload: invalidShape,
          createdBy: ACTOR
        }),
      'PAYLOAD_VALIDATION_FAILED'
    )

    const refinement = payloadFor('ResearchGoalV1', 'invalid-refinement', 1)
    refinement.composition_constraints = {
      ...(refinement.composition_constraints as Record<string, unknown>),
      required_elements: ['Sc'],
      forbidden_elements: ['Sc']
    }
    expectRepositoryError(
      () =>
        repository.create({
          projectId: PROJECT_A,
          contractId: 'ResearchGoalV1',
          entityId: 'invalid-refinement',
          payload: refinement,
          createdBy: ACTOR
        }),
      'PAYLOAD_VALIDATION_FAILED'
    )
    expect(rowCount(database)).toBe(0)
  })

  it.each([
    ['project_id', PROJECT_B],
    ['id', 'different-entity'],
    ['version', 2],
    ['created_at', '2026-08-28T15:00:00.000Z'],
    ['created_by', { kind: 'system', id: 'different-actor' }]
  ] as const)('rejects a payload/envelope mismatch for %s', (field, wrongValue) => {
    const database = openDatabase()
    insertProject(database, PROJECT_A)
    const repository = createRepository(database)
    const payload = payloadFor('ResearchGoalV1', 'mismatch-goal', 1)
    payload[field] = wrongValue

    expectRepositoryError(
      () =>
        repository.create({
          projectId: PROJECT_A,
          contractId: 'ResearchGoalV1',
          entityId: 'mismatch-goal',
          payload,
          createdBy: ACTOR
        }),
      'PAYLOAD_ENVELOPE_MISMATCH'
    )
    expect(rowCount(database)).toBe(0)
  })

  it('rejects schema literal mismatch and supersedes_id on create', () => {
    const database = openDatabase()
    insertProject(database, PROJECT_A)
    const repository = createRepository(database)
    const wrongSchema = payloadFor('ResearchGoalV1', 'wrong-schema', 1)
    wrongSchema.schema_version = 'PlanDraftV1'
    const unexpectedPredecessor = payloadFor('ResearchGoalV1', 'has-predecessor', 1)
    unexpectedPredecessor.supersedes_id = 'older-goal'

    expectRepositoryError(
      () =>
        repository.create({
          projectId: PROJECT_A,
          contractId: 'ResearchGoalV1',
          entityId: 'wrong-schema',
          payload: wrongSchema,
          createdBy: ACTOR
        }),
      'PAYLOAD_VALIDATION_FAILED'
    )
    expectRepositoryError(
      () =>
        repository.create({
          projectId: PROJECT_A,
          contractId: 'ResearchGoalV1',
          entityId: 'has-predecessor',
          payload: unexpectedPredecessor,
          createdBy: ACTOR
        }),
      'PAYLOAD_ENVELOPE_MISMATCH'
    )
    expect(rowCount(database)).toBe(0)
  })

  it.each([
    ['undefined', { invalid: undefined }],
    ['BigInt', { invalid: 1n }],
    ['Date', { invalid: new Date(NOW) }],
    ['NaN', { invalid: Number.NaN }],
    ['Infinity', { invalid: Number.POSITIVE_INFINITY }],
    ['symbol', { invalid: Symbol('invalid') }]
  ])('rejects non-JSON AgentResult output: %s', (_name, invalidOutput) => {
    const database = openDatabase()
    insertProject(database, PROJECT_A)
    const repository = createRepository(database)
    const payload = payloadFor('AgentResultV1', `non-json-${_name}`, 1)
    payload.output = invalidOutput

    expectRepositoryError(
      () =>
        repository.create({
          projectId: PROJECT_A,
          contractId: 'AgentResultV1',
          entityId: `non-json-${_name}`,
          payload,
          createdBy: ACTOR
        }),
      'PAYLOAD_NOT_JSON'
    )
    expect(rowCount(database)).toBe(0)
  })

  it('rejects cyclic JSON-like output without inserting', () => {
    const database = openDatabase()
    insertProject(database, PROJECT_A)
    const repository = createRepository(database)
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    const payload = payloadFor('AgentResultV1', 'cyclic-result', 1)
    payload.output = cyclic

    expectRepositoryError(
      () =>
        repository.create({
          projectId: PROJECT_A,
          contractId: 'AgentResultV1',
          entityId: 'cyclic-result',
          payload,
          createdBy: ACTOR
        }),
      'PAYLOAD_NOT_JSON'
    )
    expect(rowCount(database)).toBe(0)
  })

  it('enforces project existence, project-scoped exact refs and revision-one uniqueness', () => {
    const database = openDatabase()
    insertProject(database, PROJECT_A)
    insertProject(database, PROJECT_B)
    const repository = createRepository(database)
    const payload = payloadFor('TargetPropertyV1', 'target-project-scope', 1)

    expectRepositoryError(
      () =>
        repository.create({
          projectId: 'missing-project',
          contractId: 'TargetPropertyV1',
          entityId: 'missing-project-entity',
          payload: payloadFor('TargetPropertyV1', 'missing-project-entity', 1, {
            projectId: 'missing-project'
          }),
          createdBy: ACTOR
        }),
      'PROJECT_NOT_FOUND'
    )

    repository.create({
      projectId: PROJECT_A,
      contractId: 'TargetPropertyV1',
      entityId: 'target-project-scope',
      payload,
      createdBy: ACTOR
    })
    expectRepositoryError(
      () =>
        repository.create({
          projectId: PROJECT_A,
          contractId: 'TargetPropertyV1',
          entityId: 'target-project-scope',
          payload,
          createdBy: ACTOR
        }),
      'VERSION_ALREADY_EXISTS'
    )
    expectRepositoryError(
      () =>
        repository.read({
          projectId: PROJECT_B,
          ref: refFor('TargetPropertyV1', 'target-project-scope', 1)
        }),
      'VERSION_NOT_FOUND'
    )
    expectRepositoryError(
      () =>
        repository.read({
          projectId: PROJECT_A,
          ref: refFor('TargetPropertyV1', 'target-project-scope', 2)
        }),
      'VERSION_NOT_FOUND'
    )
  })

  it('returns recursively frozen detached data', () => {
    const database = openDatabase()
    insertProject(database, PROJECT_A)
    const repository = createRepository(database)
    const payload = payloadFor('ResearchGoalV1', 'frozen-goal', 1)
    const created = repository.create({
      projectId: PROJECT_A,
      contractId: 'ResearchGoalV1',
      entityId: 'frozen-goal',
      payload,
      createdBy: ACTOR
    })

    expect(Object.isFrozen(created)).toBe(true)
    expect(Object.isFrozen(created.payload)).toBe(true)
    expect(Object.isFrozen(created.payload.product)).toBe(true)
    expect(() => {
      ;(created.payload.product as { description: string }).description = 'mutated'
    }).toThrow(TypeError)
    ;(payload.product as { description: string }).description = 'caller mutation'

    const reread = repository.read({
      projectId: PROJECT_A,
      ref: refFor('ResearchGoalV1', 'frozen-goal', 1)
    })
    expect((reread.payload.product as { description: string }).description).not.toBe(
      'caller mutation'
    )
  })
})

describe('list and supersede', () => {
  function createGoalChain(
    repository: TestRepository,
    entityId: string,
    length: number
  ): TestEnvelope[] {
    const versions = [
      repository.create({
        projectId: PROJECT_A,
        contractId: 'ResearchGoalV1',
        entityId,
        payload: payloadFor('ResearchGoalV1', entityId, 1),
        createdBy: ACTOR
      })
    ]
    for (let revision = 2; revision <= length; revision += 1) {
      versions.push(
        repository.supersede({
          projectId: PROJECT_A,
          ref: refFor('ResearchGoalV1', entityId, revision - 1),
          payload: payloadFor('ResearchGoalV1', entityId, revision, { superseding: true }),
          createdBy: ACTOR
        })
      )
    }
    return versions
  }

  it('creates exactly N+1, records its predecessor and leaves old bytes unchanged', () => {
    const database = openDatabase()
    insertProject(database, PROJECT_A)
    const repository = createRepository(database, { ids: ['goal-record-1', 'goal-record-2'] })
    const first = repository.create({
      projectId: PROJECT_A,
      contractId: 'ResearchGoalV1',
      entityId: 'versioned-goal',
      payload: payloadFor('ResearchGoalV1', 'versioned-goal', 1),
      createdBy: ACTOR
    })
    const before = storedBytes(database, first.record_id)
    const second = repository.supersede({
      projectId: PROJECT_A,
      ref: refFor('ResearchGoalV1', 'versioned-goal', 1),
      payload: payloadFor('ResearchGoalV1', 'versioned-goal', 2, { superseding: true }),
      createdBy: ACTOR,
      expectedPayloadSha256: first.payload_sha256
    })

    expect(second).toMatchObject({
      record_id: 'goal-record-2',
      id: 'versioned-goal',
      version: 2,
      supersedes_ref: refFor('ResearchGoalV1', 'versioned-goal', 1)
    })
    expect(storedBytes(database, first.record_id)).toEqual(before)
    expect(repository.read({
      projectId: PROJECT_A,
      ref: refFor('ResearchGoalV1', 'versioned-goal', 1)
    })).toEqual(first)
    expect(repository.read({
      projectId: PROJECT_A,
      ref: refFor('ResearchGoalV1', 'versioned-goal', 2)
    })).toEqual(second)
  })

  it('rejects stale heads and expected-hash mismatches atomically', () => {
    const database = openDatabase()
    insertProject(database, PROJECT_A)
    const repository = createRepository(database)
    const versions = createGoalChain(repository, 'conflict-goal', 2)

    expectRepositoryError(
      () =>
        repository.supersede({
          projectId: PROJECT_A,
          ref: refFor('ResearchGoalV1', 'conflict-goal', 1),
          payload: payloadFor('ResearchGoalV1', 'conflict-goal', 2, { superseding: true }),
          createdBy: ACTOR
        }),
      'VERSION_CONFLICT'
    )
    expectRepositoryError(
      () =>
        repository.supersede({
          projectId: PROJECT_A,
          ref: refFor('ResearchGoalV1', 'conflict-goal', 2),
          payload: payloadFor('ResearchGoalV1', 'conflict-goal', 3, { superseding: true }),
          createdBy: ACTOR,
          expectedPayloadSha256: 'f'.repeat(64)
        }),
      'VERSION_CONFLICT'
    )
    expect(rowCount(database)).toBe(2)
    expect(repository.read({
      projectId: PROJECT_A,
      ref: refFor('ResearchGoalV1', 'conflict-goal', 2)
    })).toEqual(versions[1])
  })

  it('rejects an incorrect logical supersedes_id before opening a write transaction', () => {
    const database = openDatabase()
    insertProject(database, PROJECT_A)
    const repository = createRepository(database)
    repository.create({
      projectId: PROJECT_A,
      contractId: 'ResearchGoalV1',
      entityId: 'lineage-payload-goal',
      payload: payloadFor('ResearchGoalV1', 'lineage-payload-goal', 1),
      createdBy: ACTOR
    })
    const payload = payloadFor('ResearchGoalV1', 'lineage-payload-goal', 2, {
      superseding: true
    })
    payload.supersedes_id = 'different-logical-entity'

    expectRepositoryError(
      () =>
        repository.supersede({
          projectId: PROJECT_A,
          ref: refFor('ResearchGoalV1', 'lineage-payload-goal', 1),
          payload,
          createdBy: ACTOR
        }),
      'PAYLOAD_ENVELOPE_MISMATCH'
    )
    expect(rowCount(database)).toBe(1)
  })

  it('permits at most one writer from the same stale predecessor across repository instances', () => {
    const databaseName = 'double-writer.db'
    const firstDatabase = openDatabase(databaseName)
    insertProject(firstDatabase, PROJECT_A)
    const firstWriter = createRepository(firstDatabase, { ids: ['writer-record-1', 'writer-record-2'] })
    firstWriter.create({
      projectId: PROJECT_A,
      contractId: 'ResearchGoalV1',
      entityId: 'double-writer-goal',
      payload: payloadFor('ResearchGoalV1', 'double-writer-goal', 1),
      createdBy: ACTOR
    })
    const secondDatabase = openExistingDatabase(databaseName)
    const secondWriter = createRepository(secondDatabase, { ids: ['writer-record-3'] })
    const staleRef = refFor('ResearchGoalV1', 'double-writer-goal', 1)

    firstWriter.supersede({
      projectId: PROJECT_A,
      ref: staleRef,
      payload: payloadFor('ResearchGoalV1', 'double-writer-goal', 2, { superseding: true }),
      createdBy: ACTOR
    })
    expectRepositoryError(
      () =>
        secondWriter.supersede({
          projectId: PROJECT_A,
          ref: staleRef,
          payload: payloadFor('ResearchGoalV1', 'double-writer-goal', 2, {
            superseding: true
          }),
          createdBy: ACTOR
        }),
      'VERSION_CONFLICT'
    )
    expect(rowCount(secondDatabase)).toBe(2)
  })

  it('lists newest-first with bounded exclusive keyset pagination despite a new head', () => {
    const database = openDatabase()
    insertProject(database, PROJECT_A)
    const repository = createRepository(database)
    createGoalChain(repository, 'paged-goal', 5)

    const firstPage = repository.list({
      projectId: PROJECT_A,
      contractId: 'ResearchGoalV1',
      entityId: 'paged-goal',
      limit: 2
    })
    expect(firstPage.items.map((item) => item.version)).toEqual([5, 4])
    const firstCursor = firstPage.nextBeforeVersion
    expect(firstCursor).toBe(4)
    if (firstCursor === null) throw new Error('Expected a second history page')

    repository.supersede({
      projectId: PROJECT_A,
      ref: refFor('ResearchGoalV1', 'paged-goal', 5),
      payload: payloadFor('ResearchGoalV1', 'paged-goal', 6, { superseding: true }),
      createdBy: ACTOR
    })
    const secondPage = repository.list({
      projectId: PROJECT_A,
      contractId: 'ResearchGoalV1',
      entityId: 'paged-goal',
      beforeVersion: firstCursor,
      limit: 2
    })
    const secondCursor = secondPage.nextBeforeVersion
    expect(secondCursor).toBe(2)
    if (secondCursor === null) throw new Error('Expected a third history page')
    const thirdPage = repository.list({
      projectId: PROJECT_A,
      contractId: 'ResearchGoalV1',
      entityId: 'paged-goal',
      beforeVersion: secondCursor,
      limit: 2
    })

    expect(secondPage.items.map((item) => item.version)).toEqual([3, 2])
    expect(thirdPage.items.map((item) => item.version)).toEqual([1])
    expect(thirdPage.nextBeforeVersion).toBeNull()
    expect(
      [...firstPage.items, ...secondPage.items, ...thirdPage.items].map((item) => item.version)
    ).toEqual([5, 4, 3, 2, 1])
  })

  it.each([
    [{ limit: 0 }, 'INVALID_ARGUMENT'],
    [{ limit: 101 }, 'INVALID_ARGUMENT'],
    [{ limit: 1.5 }, 'INVALID_ARGUMENT'],
    [{ beforeVersion: 0 }, 'INVALID_ARGUMENT'],
    [{ beforeVersion: Number.MAX_SAFE_INTEGER + 1 }, 'INVALID_ARGUMENT']
  ] as const)('validates list bounds: %o', (invalid, code) => {
    const database = openDatabase()
    insertProject(database, PROJECT_A)
    const repository = createRepository(database)
    expectRepositoryError(
      () =>
        repository.list({
          projectId: PROJECT_A,
          contractId: 'ResearchGoalV1',
          entityId: 'bounded-list',
          ...invalid
        }),
      code
    )
  })

  it('returns an empty history for an absent entity but not for an absent project', () => {
    const database = openDatabase()
    insertProject(database, PROJECT_A)
    const repository = createRepository(database)
    expect(repository.list({
      projectId: PROJECT_A,
      contractId: 'ResearchGoalV1',
      entityId: 'absent-goal'
    })).toEqual({ items: [], nextBeforeVersion: null })
    expectRepositoryError(
      () =>
        repository.list({
          projectId: 'absent-project',
          contractId: 'ResearchGoalV1',
          entityId: 'absent-goal'
        }),
      'PROJECT_NOT_FOUND'
    )
  })
})

describe('fail-closed stored-data integrity', () => {
  it.each([
    ['non-canonical JSON', 'TargetPropertyV1', '{ "id": "raw" }', sha256('{ "id": "raw" }')],
    ['wrong hash', 'TargetPropertyV1', '{"id":"raw"}', '0'.repeat(64)],
    ['invalid Zod payload', 'TargetPropertyV1', '{"id":"raw"}', sha256('{"id":"raw"}')]
  ])('rejects a directly inserted %s row', (_name, contractId, payloadJson, payloadSha256) => {
    const database = openDatabase()
    insertProject(database, PROJECT_A)
    insertRawVersion(database, {
      recordId: `corrupt-${_name.replaceAll(' ', '-')}`,
      contractId,
      entityId: 'raw',
      payloadJson,
      payloadSha256
    })
    const repository = createRepository(database)

    expectRepositoryError(
      () =>
        repository.read({
          projectId: PROJECT_A,
          ref: {
            entity_type: contractId,
            entity_id: 'raw',
            version: 1
          }
        }),
      'STORAGE_CORRUPTION'
    )
  })

  it('rejects invalid JSON inserted with SQLite checks deliberately bypassed', () => {
    const database = openDatabase()
    insertProject(database, PROJECT_A)
    database.exec('PRAGMA ignore_check_constraints = ON;')
    try {
      insertRawVersion(database, {
        recordId: 'invalid-json-record',
        contractId: 'TargetPropertyV1',
        entityId: 'invalid-json-entity',
        payloadJson: '{not-json',
        payloadSha256: sha256('{not-json')
      })
    } finally {
      database.exec('PRAGMA ignore_check_constraints = OFF;')
    }
    const repository = createRepository(database)

    expectRepositoryError(
      () =>
        repository.read({
          projectId: PROJECT_A,
          ref: refFor('TargetPropertyV1', 'invalid-json-entity', 1)
        }),
      'STORAGE_CORRUPTION'
    )
  })

  it('detects a directly inserted unknown-contract child while validating known lineage', () => {
    const database = openDatabase()
    insertProject(database, PROJECT_A)
    const repository = createRepository(database, { ids: ['known-parent-record'] })
    repository.create({
      projectId: PROJECT_A,
      contractId: 'TargetPropertyV1',
      entityId: 'known-parent',
      payload: payloadFor('TargetPropertyV1', 'known-parent', 1),
      createdBy: ACTOR
    })
    const payloadJson = '{"value":1}'
    insertRawVersion(database, {
      recordId: 'unknown-contract-record',
      contractId: 'UnknownContractV1',
      entityId: 'known-parent',
      revision: 2,
      payloadJson,
      supersedesRecordId: 'known-parent-record'
    })

    expectRepositoryError(
      () =>
        repository.read({
          projectId: PROJECT_A,
          ref: refFor('TargetPropertyV1', 'known-parent', 1)
        }),
      'STORAGE_CORRUPTION'
    )
  })

  it('rejects payload/envelope corruption and does not hide it from list', () => {
    const database = openDatabase()
    insertProject(database, PROJECT_A)
    const payload = payloadFor('ResearchGoalV1', 'payload-id', 1)
    const payloadJson = canonicalJson(payload)
    insertRawVersion(database, {
      recordId: 'envelope-corrupt-record',
      contractId: 'ResearchGoalV1',
      entityId: 'envelope-id',
      payloadJson
    })
    const repository = createRepository(database)

    expectRepositoryError(
      () =>
        repository.list({
          projectId: PROJECT_A,
          contractId: 'ResearchGoalV1',
          entityId: 'envelope-id'
        }),
      'STORAGE_CORRUPTION'
    )
  })

  it('rejects a predecessor from another logical line', () => {
    const database = openDatabase()
    insertProject(database, PROJECT_A)
    const repository = createRepository(database, { ids: ['line-a-record-1'] })
    repository.create({
      projectId: PROJECT_A,
      contractId: 'TargetPropertyV1',
      entityId: 'line-a',
      payload: payloadFor('TargetPropertyV1', 'line-a', 1),
      createdBy: ACTOR
    })
    const secondPayload = canonicalJson(payloadFor('TargetPropertyV1', 'line-b', 2))
    insertRawVersion(database, {
      recordId: 'line-b-record-2',
      contractId: 'TargetPropertyV1',
      entityId: 'line-b',
      revision: 2,
      payloadJson: secondPayload,
      supersedesRecordId: 'line-a-record-1'
    })

    expectRepositoryError(
      () =>
        repository.read({
          projectId: PROJECT_A,
          ref: refFor('TargetPropertyV1', 'line-b', 2)
        }),
      'STORAGE_CORRUPTION'
    )
  })

  it('rejects a revision gap even when the predecessor pointer exists', () => {
    const database = openDatabase()
    insertProject(database, PROJECT_A)
    const repository = createRepository(database, { ids: ['gap-root-record'] })
    repository.create({
      projectId: PROJECT_A,
      contractId: 'TargetPropertyV1',
      entityId: 'gap-entity',
      payload: payloadFor('TargetPropertyV1', 'gap-entity', 1),
      createdBy: ACTOR
    })
    const rootBytes = storedBytes(database, 'gap-root-record')
    insertRawVersion(database, {
      recordId: 'gap-child-record',
      contractId: 'TargetPropertyV1',
      entityId: 'gap-entity',
      revision: 3,
      payloadJson: String(rootBytes.payload_json),
      supersedesRecordId: 'gap-root-record'
    })

    expectRepositoryError(
      () =>
        repository.read({
          projectId: PROJECT_A,
          ref: refFor('TargetPropertyV1', 'gap-entity', 1)
        }),
      'STORAGE_CORRUPTION'
    )
  })

  it('treats multiple children as corruption rather than a normal stale conflict', () => {
    const database = openDatabase()
    insertProject(database, PROJECT_A)
    const rootJson = JSON.stringify(payloadFor('TargetPropertyV1', 'branched', 1))
    insertRawVersion(database, {
      recordId: 'branch-root',
      contractId: 'TargetPropertyV1',
      entityId: 'branched',
      payloadJson: rootJson
    })
    const childJson = JSON.stringify(payloadFor('TargetPropertyV1', 'branched', 2))
    insertRawVersion(database, {
      recordId: 'branch-child-a',
      contractId: 'TargetPropertyV1',
      entityId: 'branched',
      revision: 2,
      payloadJson: childJson,
      supersedesRecordId: 'branch-root'
    })
    insertRawVersion(database, {
      recordId: 'branch-child-b',
      contractId: 'TargetPropertyV1',
      entityId: 'branched-other',
      revision: 2,
      payloadJson: JSON.stringify(payloadFor('TargetPropertyV1', 'branched-other', 2)),
      supersedesRecordId: 'branch-root'
    })
    const repository = createRepository(database)

    expectRepositoryError(
      () =>
        repository.supersede({
          projectId: PROJECT_A,
          ref: refFor('TargetPropertyV1', 'branched', 1),
          payload: payloadFor('TargetPropertyV1', 'branched', 2),
          createdBy: ACTOR
        }),
      'STORAGE_CORRUPTION'
    )
    expect(rowCount(database)).toBe(3)
  })

  it('rejects an unsafe stored revision through list', () => {
    const database = openDatabase()
    insertProject(database, PROJECT_A)
    const payloadJson = JSON.stringify(payloadFor('TargetPropertyV1', 'unsafe-revision', 1))
    insertRawVersion(database, {
      recordId: 'unsafe-revision-record',
      contractId: 'TargetPropertyV1',
      entityId: 'unsafe-revision',
      revision: 9_007_199_254_740_992n,
      payloadJson
    })
    const repository = createRepository(database)

    expectRepositoryError(
      () =>
        repository.list({
          projectId: PROJECT_A,
          contractId: 'TargetPropertyV1',
          entityId: 'unsafe-revision'
        }),
      'STORAGE_CORRUPTION'
    )
  })
})

describe('transactions, error hygiene and database barriers', () => {
  it('rolls back a record-id collision and keeps public messages free of SQL and payload data', () => {
    const database = openDatabase()
    insertProject(database, PROJECT_A)
    const repository = createRepository(database, { ids: ['duplicate-record', 'duplicate-record'] })
    repository.create({
      projectId: PROJECT_A,
      contractId: 'TargetPropertyV1',
      entityId: 'collision-first',
      payload: payloadFor('TargetPropertyV1', 'collision-first', 1),
      createdBy: ACTOR
    })
    const secret = 'payload-secret-must-not-leak'
    const secondPayload = payloadFor('AgentResultV1', 'collision-second', 1)
    secondPayload.output = { secret }

    const error = expectRepositoryError(
      () =>
        repository.create({
          projectId: PROJECT_A,
          contractId: 'AgentResultV1',
          entityId: 'collision-second',
          payload: secondPayload,
          createdBy: ACTOR
        }),
      'RECORD_ID_COLLISION'
    )

    expect(rowCount(database)).toBe(1)
    expect(error.message).not.toContain('INSERT')
    expect(error.message).not.toContain('materials_object_versions')
    expect(error.message).not.toContain(secret)
    expect(error.message).not.toContain(temporaryRoot)
  })

  it('rolls back an unexpected INSERT failure and sanitizes the public error', () => {
    const database = openDatabase()
    insertProject(database, PROJECT_A)
    const repository = createRepository(database, { ids: ['trigger-failure-record'] })
    const rawSecret = 'raw-sql-secret-that-must-not-leak'
    database.exec(`
      CREATE TRIGGER fixture_reject_materials_insert
      BEFORE INSERT ON materials_object_versions
      BEGIN
        SELECT RAISE(ABORT, '${rawSecret}');
      END;
    `)

    const error = expectRepositoryError(
      () =>
        repository.create({
          projectId: PROJECT_A,
          contractId: 'TargetPropertyV1',
          entityId: 'trigger-failure-entity',
          payload: payloadFor('TargetPropertyV1', 'trigger-failure-entity', 1),
          createdBy: ACTOR
        }),
      'STORAGE_FAILURE'
    )
    expect(rowCount(database)).toBe(0)
    expect(error.message).not.toContain(rawSecret)
    expect(error.message).not.toContain('INSERT')

    database.exec('DROP TRIGGER fixture_reject_materials_insert;')
    const recovered = repository.create({
      projectId: PROJECT_A,
      contractId: 'TargetPropertyV1',
      entityId: 'trigger-recovery-entity',
      payload: payloadFor('TargetPropertyV1', 'trigger-recovery-entity', 1),
      createdBy: ACTOR
    })
    expect(recovered.record_id).toBe('record-1')
    expect(rowCount(database)).toBe(1)
  })

  it('keeps the append-only UPDATE and DELETE triggers as a raw SQL backstop', () => {
    const database = openDatabase()
    insertProject(database, PROJECT_A)
    const repository = createRepository(database, { ids: ['immutable-record'] })
    repository.create({
      projectId: PROJECT_A,
      contractId: 'TargetPropertyV1',
      entityId: 'immutable-target',
      payload: payloadFor('TargetPropertyV1', 'immutable-target', 1),
      createdBy: ACTOR
    })
    const before = storedBytes(database, 'immutable-record')

    expect(() =>
      database
        .prepare('UPDATE materials_object_versions SET payload_json = ? WHERE record_id = ?')
        .run('{}', 'immutable-record')
    ).toThrow()
    expect(() =>
      database
        .prepare('DELETE FROM materials_object_versions WHERE record_id = ?')
        .run('immutable-record')
    ).toThrow()
    expect(storedBytes(database, 'immutable-record')).toEqual(before)
  })

  it('leaves no open transaction after a rejected write', () => {
    const database = openDatabase()
    insertProject(database, PROJECT_A)
    const repository = createRepository(database, { ids: ['same-record', 'same-record', 'recovery-record'] })
    repository.create({
      projectId: PROJECT_A,
      contractId: 'TargetPropertyV1',
      entityId: 'transaction-first',
      payload: payloadFor('TargetPropertyV1', 'transaction-first', 1),
      createdBy: ACTOR
    })
    expectRepositoryError(
      () =>
        repository.create({
          projectId: PROJECT_A,
          contractId: 'TargetPropertyV1',
          entityId: 'transaction-collision',
          payload: payloadFor('TargetPropertyV1', 'transaction-collision', 1),
          createdBy: ACTOR
        }),
      'RECORD_ID_COLLISION'
    )

    const recovered = repository.create({
      projectId: PROJECT_A,
      contractId: 'TargetPropertyV1',
      entityId: 'transaction-recovered',
      payload: payloadFor('TargetPropertyV1', 'transaction-recovered', 1),
      createdBy: ACTOR
    })
    expect(recovered.record_id).toBe('recovery-record')
    expect(rowCount(database)).toBe(2)
  })

  it('persists data across a physical close and reopen using the production migrations and SQL', () => {
    const databaseName = 'physical-reopen.db'
    const database = openDatabase(databaseName)
    insertProject(database, PROJECT_A)
    const repository = createRepository(database, { ids: ['physical-record'] })
    const created = repository.create({
      projectId: PROJECT_A,
      contractId: 'TargetPropertyV1',
      entityId: 'physical-target',
      payload: payloadFor('TargetPropertyV1', 'physical-target', 1),
      createdBy: ACTOR
    })
    closeDatabase(database)

    const reopened = openExistingDatabase(databaseName)
    const reopenedRepository = createRepository(reopened)
    expect(reopenedRepository.read({
      projectId: PROJECT_A,
      ref: refFor('TargetPropertyV1', 'physical-target', 1)
    })).toEqual(created)
  })
})
