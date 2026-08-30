import { createHash, randomUUID } from 'node:crypto'
import {
  ActorRefSchema,
  EntityIdSchema,
  IsoDateTimeSchema,
  PositiveIntegerSchema,
  VersionRefSchema,
  type ActorRef,
  type EntityId,
  type IsoDateTime,
  type VersionRef
} from '../contracts/common'
import {
  canonicalizeMaterialsJson,
  materialsV1ContractRegistry,
  type MaterialsJsonValue,
  type MaterialsV1ContractInput,
  type MaterialsV1ContractName,
  type MaterialsV1ContractOutput
} from '../contracts/jsonSchema'

export interface MaterialsVersionSqliteStatement {
  get(...parameters: any[]): unknown
  all(...parameters: any[]): unknown[]
  run(...parameters: any[]): unknown
}

export interface MaterialsVersionSqliteDatabase {
  exec(sql: string): unknown
  prepare(sql: string): MaterialsVersionSqliteStatement
}

export type MaterialsVersionRepositoryOperation =
  | 'create'
  | 'read'
  | 'list'
  | 'supersede'

export type MaterialsVersionRepositoryErrorCode =
  | 'INVALID_ARGUMENT'
  | 'UNKNOWN_CONTRACT'
  | 'PAYLOAD_VALIDATION_FAILED'
  | 'PAYLOAD_ENVELOPE_MISMATCH'
  | 'PAYLOAD_NOT_JSON'
  | 'PROJECT_NOT_FOUND'
  | 'VERSION_NOT_FOUND'
  | 'VERSION_ALREADY_EXISTS'
  | 'VERSION_CONFLICT'
  | 'RECORD_ID_COLLISION'
  | 'STORAGE_CORRUPTION'
  | 'STORAGE_FAILURE'

interface MaterialsVersionRepositoryErrorOptions {
  code: MaterialsVersionRepositoryErrorCode
  operation: MaterialsVersionRepositoryOperation
  projectId: EntityId | null
  ref?: VersionRef
  cause?: unknown
}

const PUBLIC_ERROR_MESSAGES: Readonly<
  Record<MaterialsVersionRepositoryErrorCode, string>
> = Object.freeze({
  INVALID_ARGUMENT: 'Invalid materials version repository argument',
  UNKNOWN_CONTRACT: 'Unknown materials contract',
  PAYLOAD_VALIDATION_FAILED: 'Materials payload does not satisfy its contract',
  PAYLOAD_ENVELOPE_MISMATCH: 'Materials payload does not match its storage envelope',
  PAYLOAD_NOT_JSON: 'Materials payload is not canonical JSON',
  PROJECT_NOT_FOUND: 'Materials project was not found',
  VERSION_NOT_FOUND: 'Materials version was not found',
  VERSION_ALREADY_EXISTS: 'Materials version already exists',
  VERSION_CONFLICT: 'Materials version has a concurrent successor',
  RECORD_ID_COLLISION: 'Generated materials record identifier is already in use',
  STORAGE_CORRUPTION: 'Materials version storage failed an integrity check',
  STORAGE_FAILURE: 'Materials version storage operation failed'
})

export class MaterialsVersionRepositoryError extends Error {
  readonly code: MaterialsVersionRepositoryErrorCode
  readonly operation: MaterialsVersionRepositoryOperation
  readonly projectId: EntityId | null
  readonly ref?: Readonly<VersionRef>
  override readonly cause: unknown

  constructor(options: MaterialsVersionRepositoryErrorOptions) {
    super(PUBLIC_ERROR_MESSAGES[options.code], { cause: options.cause })
    this.name = 'MaterialsVersionRepositoryError'
    this.code = options.code
    this.operation = options.operation
    this.projectId = options.projectId
    this.ref = options.ref === undefined ? undefined : deepFreeze({ ...options.ref })
    this.cause = options.cause
  }
}

export type StoredMaterialsVersion<
  Name extends MaterialsV1ContractName = MaterialsV1ContractName
> = Readonly<{
  record_id: EntityId
  project_id: EntityId
  schema_version: Name
  id: EntityId
  version: number
  payload: MaterialsV1ContractOutput<Name>
  payload_sha256: string
  supersedes_ref: Readonly<VersionRef> | null
  created_at: IsoDateTime
  created_by: Readonly<ActorRef>
}>

export type MaterialsVersionPage<
  Name extends MaterialsV1ContractName = MaterialsV1ContractName
> = Readonly<{
  items: readonly StoredMaterialsVersion<Name>[]
  nextBeforeVersion: number | null
}>

export type CreateMaterialsVersionInput<Name extends MaterialsV1ContractName> = Readonly<{
  projectId: EntityId
  contractId: Name
  entityId: EntityId
  payload: MaterialsV1ContractInput<Name>
  createdBy: ActorRef
  createdAt?: IsoDateTime
}>

export type ReadMaterialsVersionInput<Name extends MaterialsV1ContractName> = Readonly<{
  projectId: EntityId
  ref: VersionRef & Readonly<{ entity_type: Name }>
}>

export type ListMaterialsVersionsInput<Name extends MaterialsV1ContractName> = Readonly<{
  projectId: EntityId
  contractId: Name
  entityId: EntityId
  beforeVersion?: number
  limit?: number
}>

export type SupersedeMaterialsVersionInput<Name extends MaterialsV1ContractName> = Readonly<{
  projectId: EntityId
  ref: VersionRef & Readonly<{ entity_type: Name }>
  payload: MaterialsV1ContractInput<Name>
  createdBy: ActorRef
  createdAt?: IsoDateTime
  expectedPayloadSha256?: string
}>

export interface MaterialsVersionRepositoryOptions {
  now?: () => string
  generateRecordId?: () => string
}

type RowRecord = Record<string, unknown>

type PersistedVersionRow = Readonly<{
  recordId: EntityId
  projectId: EntityId
  contractId: MaterialsV1ContractName
  entityId: EntityId
  revision: number
  payloadJson: string
  payloadSha256: string
  supersedesRecordId: EntityId | null
  createdAt: IsoDateTime
  createdBy: ActorRef
}>

type DecodedVersionRow<Name extends MaterialsV1ContractName = MaterialsV1ContractName> =
  Readonly<{
    persisted: PersistedVersionRow & Readonly<{ contractId: Name }>
    stored: StoredMaterialsVersion<Name>
  }>

type PreparedPayload<Name extends MaterialsV1ContractName> = Readonly<{
  payload: MaterialsV1ContractOutput<Name>
  json: string
  sha256: string
}>

const VERSION_COLUMNS = `
  record_id,
  project_id,
  contract_id,
  entity_id,
  CAST(entity_revision AS TEXT) AS entity_revision_text,
  payload_json,
  payload_sha256,
  supersedes_record_id,
  created_at,
  created_by_kind,
  created_by_id`

const CHILD_VERSION_COLUMNS = `
  child.record_id AS record_id,
  child.project_id AS project_id,
  child.contract_id AS contract_id,
  child.entity_id AS entity_id,
  CAST(child.entity_revision AS TEXT) AS entity_revision_text,
  child.payload_json AS payload_json,
  child.payload_sha256 AS payload_sha256,
  child.supersedes_record_id AS supersedes_record_id,
  child.created_at AS created_at,
  child.created_by_kind AS created_by_kind,
  child.created_by_id AS created_by_id`

const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 100
const SHA256_PATTERN = /^[0-9a-f]{64}$/

function deepFreeze<Value>(value: Value): Readonly<Value> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child)
    }
    Object.freeze(value)
  }
  return value as Readonly<Value>
}

function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function isRecord(value: unknown): value is RowRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isKnownContract(value: string): value is MaterialsV1ContractName {
  return hasOwn(materialsV1ContractRegistry, value)
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function error(
  code: MaterialsVersionRepositoryErrorCode,
  operation: MaterialsVersionRepositoryOperation,
  projectId: EntityId | null,
  ref: VersionRef | undefined,
  cause?: unknown
): MaterialsVersionRepositoryError {
  return new MaterialsVersionRepositoryError({ code, operation, projectId, ref, cause })
}

function rethrowOrWrap(
  cause: unknown,
  operation: MaterialsVersionRepositoryOperation,
  projectId: EntityId | null,
  ref?: VersionRef
): never {
  if (cause instanceof MaterialsVersionRepositoryError) throw cause
  throw error('STORAGE_FAILURE', operation, projectId, ref, cause)
}

function parseEntityId(
  value: unknown,
  operation: MaterialsVersionRepositoryOperation,
  projectId: EntityId | null,
  ref?: VersionRef
): EntityId {
  const result = EntityIdSchema.safeParse(value)
  if (!result.success) {
    throw error('INVALID_ARGUMENT', operation, projectId, ref, result.error)
  }
  return result.data
}

function parseContractId(
  value: unknown,
  operation: MaterialsVersionRepositoryOperation,
  projectId: EntityId | null,
  ref?: VersionRef
): MaterialsV1ContractName {
  if (typeof value !== 'string' || !isKnownContract(value)) {
    throw error(
      typeof value === 'string' ? 'UNKNOWN_CONTRACT' : 'INVALID_ARGUMENT',
      operation,
      projectId,
      ref,
      new TypeError('contractId must be an exact materials contract key')
    )
  }
  return value
}

function parseActor(
  value: unknown,
  operation: MaterialsVersionRepositoryOperation,
  projectId: EntityId,
  ref?: VersionRef
): ActorRef {
  const result = ActorRefSchema.safeParse(value)
  if (!result.success) {
    throw error('INVALID_ARGUMENT', operation, projectId, ref, result.error)
  }
  return result.data
}

function parseVersionRef(
  value: unknown,
  operation: MaterialsVersionRepositoryOperation,
  projectId: EntityId
): VersionRef {
  const result = VersionRefSchema.safeParse(value)
  if (!result.success) {
    throw error('INVALID_ARGUMENT', operation, projectId, undefined, result.error)
  }
  const ref = result.data
  if (!Number.isSafeInteger(ref.version)) {
    throw error('INVALID_ARGUMENT', operation, projectId, ref)
  }
  parseContractId(ref.entity_type, operation, projectId, ref)
  return ref
}

function parseTimestamp(
  value: unknown,
  operation: MaterialsVersionRepositoryOperation,
  projectId: EntityId,
  ref?: VersionRef
): IsoDateTime {
  const result = IsoDateTimeSchema.safeParse(value)
  if (!result.success) {
    throw error('INVALID_ARGUMENT', operation, projectId, ref, result.error)
  }
  return result.data
}

function assertPayloadEnvelope(
  payload: unknown,
  envelope: {
    projectId: EntityId
    contractId: MaterialsV1ContractName
    entityId: EntityId
    revision: number
    createdAt: IsoDateTime
    createdBy: ActorRef
    predecessorEntityId: EntityId | null
  },
  operation: MaterialsVersionRepositoryOperation,
  ref: VersionRef | undefined,
  mismatchCode: 'PAYLOAD_ENVELOPE_MISMATCH' | 'STORAGE_CORRUPTION'
): void {
  if (!isRecord(payload)) {
    throw error(mismatchCode, operation, envelope.projectId, ref)
  }

  const expected: Readonly<Record<string, unknown>> = {
    schema_version: envelope.contractId,
    id: envelope.entityId,
    version: envelope.revision,
    project_id: envelope.projectId,
    created_at: envelope.createdAt
  }
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (hasOwn(payload, field) && payload[field] !== expectedValue) {
      throw error(
        mismatchCode,
        operation,
        envelope.projectId,
        ref,
        new Error(`payload ${field} does not match envelope`)
      )
    }
  }

  if (hasOwn(payload, 'created_by')) {
    const actual = payload.created_by
    if (
      !isRecord(actual) ||
      actual.kind !== envelope.createdBy.kind ||
      actual.id !== envelope.createdBy.id
    ) {
      throw error(
        mismatchCode,
        operation,
        envelope.projectId,
        ref,
        new Error('payload created_by does not match envelope')
      )
    }
  }

  if (hasOwn(payload, 'supersedes_id')) {
    if (
      envelope.predecessorEntityId === null ||
      payload.supersedes_id !== envelope.predecessorEntityId
    ) {
      throw error(
        mismatchCode,
        operation,
        envelope.projectId,
        ref,
        new Error('payload supersedes_id does not match predecessor')
      )
    }
  }
}

function preparePayload<Name extends MaterialsV1ContractName>(
  contractId: Name,
  payload: unknown,
  envelope: {
    projectId: EntityId
    entityId: EntityId
    revision: number
    createdAt: IsoDateTime
    createdBy: ActorRef
    predecessorEntityId: EntityId | null
  },
  operation: 'create' | 'supersede',
  ref?: VersionRef
): PreparedPayload<Name> {
  const schema = materialsV1ContractRegistry[contractId]
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw error('PAYLOAD_VALIDATION_FAILED', operation, envelope.projectId, ref, parsed.error)
  }

  assertPayloadEnvelope(
    parsed.data,
    { ...envelope, contractId },
    operation,
    ref,
    'PAYLOAD_ENVELOPE_MISMATCH'
  )

  let firstJson: string
  try {
    const canonical = canonicalizeMaterialsJson(parsed.data)
    if (!isRecord(canonical)) throw new TypeError('stored payload root must be an object')
    firstJson = JSON.stringify(canonical)
  } catch (cause) {
    throw error('PAYLOAD_NOT_JSON', operation, envelope.projectId, ref, cause)
  }

  let roundTrip: unknown
  try {
    roundTrip = JSON.parse(firstJson) as unknown
  } catch (cause) {
    throw error('PAYLOAD_NOT_JSON', operation, envelope.projectId, ref, cause)
  }
  const reparsed = schema.safeParse(roundTrip)
  if (!reparsed.success) {
    throw error(
      'PAYLOAD_VALIDATION_FAILED',
      operation,
      envelope.projectId,
      ref,
      reparsed.error
    )
  }
  assertPayloadEnvelope(
    reparsed.data,
    { ...envelope, contractId },
    operation,
    ref,
    'PAYLOAD_ENVELOPE_MISMATCH'
  )

  let canonicalPayload: MaterialsJsonValue
  let canonicalJson: string
  try {
    canonicalPayload = canonicalizeMaterialsJson(reparsed.data)
    if (!isRecord(canonicalPayload)) {
      throw new TypeError('stored payload root must be an object')
    }
    canonicalJson = JSON.stringify(canonicalPayload)
  } catch (cause) {
    throw error('PAYLOAD_NOT_JSON', operation, envelope.projectId, ref, cause)
  }
  if (canonicalJson !== firstJson) {
    throw error(
      'PAYLOAD_NOT_JSON',
      operation,
      envelope.projectId,
      ref,
      new Error('payload is not stable across a JSON round-trip')
    )
  }

  return Object.freeze({
    payload: canonicalPayload as MaterialsV1ContractOutput<Name>,
    json: canonicalJson,
    sha256: sha256(canonicalJson)
  })
}

function rowString(row: RowRecord, key: string): string | null {
  const value = row[key]
  return typeof value === 'string' ? value : null
}

function parsePersistedRow(
  raw: unknown,
  operation: 'read' | 'list' | 'supersede',
  expectedProjectId: EntityId,
  expectedRef?: VersionRef
): PersistedVersionRow {
  if (!isRecord(raw)) {
    throw error('STORAGE_CORRUPTION', operation, expectedProjectId, expectedRef)
  }

  const recordIdResult = EntityIdSchema.safeParse(rowString(raw, 'record_id'))
  const projectIdResult = EntityIdSchema.safeParse(rowString(raw, 'project_id'))
  const entityIdResult = EntityIdSchema.safeParse(rowString(raw, 'entity_id'))
  const createdAtResult = IsoDateTimeSchema.safeParse(rowString(raw, 'created_at'))
  const createdByResult = ActorRefSchema.safeParse({
    kind: rowString(raw, 'created_by_kind'),
    id: rowString(raw, 'created_by_id')
  })
  const revisionText = rowString(raw, 'entity_revision_text')
  const revision =
    revisionText !== null && /^[1-9][0-9]*$/.test(revisionText)
      ? Number(revisionText)
      : Number.NaN
  const payloadJson = rowString(raw, 'payload_json')
  const payloadSha256 = rowString(raw, 'payload_sha256')
  const supersedesRaw = raw.supersedes_record_id
  const supersedesResult =
    supersedesRaw === null ? null : EntityIdSchema.safeParse(supersedesRaw)
  const contractRaw = rowString(raw, 'contract_id')

  if (
    !recordIdResult.success ||
    !projectIdResult.success ||
    !entityIdResult.success ||
    !createdAtResult.success ||
    !createdByResult.success ||
    !Number.isSafeInteger(revision) ||
    (revision as number) < 1 ||
    payloadJson === null ||
    payloadSha256 === null ||
    !SHA256_PATTERN.test(payloadSha256) ||
    supersedesResult === undefined ||
    (supersedesResult !== null && !supersedesResult.success) ||
    contractRaw === null ||
    !isKnownContract(contractRaw)
  ) {
    throw error('STORAGE_CORRUPTION', operation, expectedProjectId, expectedRef)
  }

  if (projectIdResult.data !== expectedProjectId) {
    throw error('STORAGE_CORRUPTION', operation, expectedProjectId, expectedRef)
  }
  if (
    expectedRef !== undefined &&
    (contractRaw !== expectedRef.entity_type ||
      entityIdResult.data !== expectedRef.entity_id ||
      revision !== expectedRef.version)
  ) {
    throw error('STORAGE_CORRUPTION', operation, expectedProjectId, expectedRef)
  }

  return Object.freeze({
    recordId: recordIdResult.data,
    projectId: projectIdResult.data,
    contractId: contractRaw,
    entityId: entityIdResult.data,
    revision: revision as number,
    payloadJson,
    payloadSha256,
    supersedesRecordId:
      supersedesResult === null ? null : (supersedesResult.data as EntityId),
    createdAt: createdAtResult.data,
    createdBy: createdByResult.data
  })
}

function decodePersistedRow<Name extends MaterialsV1ContractName>(
  raw: unknown,
  operation: 'read' | 'list' | 'supersede',
  expectedProjectId: EntityId,
  expectedRef?: VersionRef & Readonly<{ entity_type: Name }>
): DecodedVersionRow<Name> {
  const persisted = parsePersistedRow(raw, operation, expectedProjectId, expectedRef)
  const contractId = persisted.contractId as Name
  const ref: VersionRef = {
    entity_type: contractId,
    entity_id: persisted.entityId,
    version: persisted.revision
  }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(persisted.payloadJson) as unknown
  } catch (cause) {
    throw error('STORAGE_CORRUPTION', operation, expectedProjectId, ref, cause)
  }
  if (!isRecord(parsedJson)) {
    throw error('STORAGE_CORRUPTION', operation, expectedProjectId, ref)
  }

  let canonicalJson: string
  try {
    canonicalJson = JSON.stringify(canonicalizeMaterialsJson(parsedJson))
  } catch (cause) {
    throw error('STORAGE_CORRUPTION', operation, expectedProjectId, ref, cause)
  }
  if (canonicalJson !== persisted.payloadJson || sha256(persisted.payloadJson) !== persisted.payloadSha256) {
    throw error('STORAGE_CORRUPTION', operation, expectedProjectId, ref)
  }

  const parsedPayload = materialsV1ContractRegistry[contractId].safeParse(parsedJson)
  if (!parsedPayload.success) {
    throw error('STORAGE_CORRUPTION', operation, expectedProjectId, ref, parsedPayload.error)
  }

  let payload: MaterialsJsonValue
  try {
    payload = canonicalizeMaterialsJson(parsedPayload.data)
  } catch (cause) {
    throw error('STORAGE_CORRUPTION', operation, expectedProjectId, ref, cause)
  }
  if (!isRecord(payload) || JSON.stringify(payload) !== persisted.payloadJson) {
    throw error('STORAGE_CORRUPTION', operation, expectedProjectId, ref)
  }

  assertPayloadEnvelope(
    payload,
    {
      projectId: persisted.projectId,
      contractId,
      entityId: persisted.entityId,
      revision: persisted.revision,
      createdAt: persisted.createdAt,
      createdBy: persisted.createdBy,
      predecessorEntityId: persisted.revision === 1 ? null : persisted.entityId
    },
    operation,
    ref,
    'STORAGE_CORRUPTION'
  )

  if (
    (persisted.revision === 1 && persisted.supersedesRecordId !== null) ||
    (persisted.revision > 1 && persisted.supersedesRecordId === null)
  ) {
    throw error('STORAGE_CORRUPTION', operation, expectedProjectId, ref)
  }

  const supersedesRef: Readonly<VersionRef> | null =
    persisted.revision === 1
      ? null
      : deepFreeze({
          entity_type: contractId,
          entity_id: persisted.entityId,
          version: persisted.revision - 1
        })
  const stored = deepFreeze({
    record_id: persisted.recordId,
    project_id: persisted.projectId,
    schema_version: contractId,
    id: persisted.entityId,
    version: persisted.revision,
    payload: payload as MaterialsV1ContractOutput<Name>,
    payload_sha256: persisted.payloadSha256,
    supersedes_ref: supersedesRef,
    created_at: persisted.createdAt,
    created_by: { ...persisted.createdBy }
  }) as StoredMaterialsVersion<Name>

  return Object.freeze({
    persisted: persisted as PersistedVersionRow & Readonly<{ contractId: Name }>,
    stored
  })
}

export class MaterialsVersionRepository {
  readonly #database: MaterialsVersionSqliteDatabase
  readonly #now: () => string
  readonly #generateRecordId: () => string

  constructor(
    database: MaterialsVersionSqliteDatabase,
    options: MaterialsVersionRepositoryOptions = {}
  ) {
    if (
      !database ||
      typeof database.exec !== 'function' ||
      typeof database.prepare !== 'function'
    ) {
      throw new TypeError('MaterialsVersionRepository requires a SQLite adapter')
    }
    if (options.now !== undefined && typeof options.now !== 'function') {
      throw new TypeError('MaterialsVersionRepository now option must be a function')
    }
    if (
      options.generateRecordId !== undefined &&
      typeof options.generateRecordId !== 'function'
    ) {
      throw new TypeError('MaterialsVersionRepository generateRecordId option must be a function')
    }
    this.#database = database
    this.#now = options.now ?? (() => new Date().toISOString())
    this.#generateRecordId = options.generateRecordId ?? randomUUID
  }

  create<Name extends MaterialsV1ContractName>(
    input: CreateMaterialsVersionInput<Name>
  ): StoredMaterialsVersion<Name> {
    const operation = 'create' as const
    let projectId: EntityId | null = null
    try {
      if (!isRecord(input)) throw error('INVALID_ARGUMENT', operation, null, undefined)
      projectId = parseEntityId(input.projectId, operation, null)
      const validatedProjectId = projectId
      const contractId = parseContractId(input.contractId, operation, projectId) as Name
      const entityId = parseEntityId(input.entityId, operation, projectId)
      const createdBy = parseActor(input.createdBy, operation, projectId)
      const createdAt = parseTimestamp(input.createdAt ?? this.#now(), operation, projectId)
      const recordId = parseEntityId(this.#generateRecordId(), operation, projectId)
      const prepared = preparePayload(
        contractId,
        input.payload,
        {
          projectId,
          entityId,
          revision: 1,
          createdAt,
          createdBy,
          predecessorEntityId: null
        },
        operation
      )

      return this.#writeTransaction(operation, validatedProjectId, undefined, () => {
        this.#assertProjectExists(operation, validatedProjectId)
        const existing = this.#database
          .prepare(
            `SELECT record_id FROM materials_object_versions
             WHERE project_id = ? AND contract_id = ? AND entity_id = ?
             LIMIT 1`
          )
          .get(validatedProjectId, contractId, entityId)
        if (existing !== undefined) {
          throw error('VERSION_ALREADY_EXISTS', operation, validatedProjectId, undefined)
        }
        this.#assertRecordIdAvailable(operation, validatedProjectId, undefined, recordId)
        this.#insert({
          recordId,
          projectId: validatedProjectId,
          contractId,
          entityId,
          revision: 1,
          prepared,
          supersedesRecordId: null,
          createdAt,
          createdBy
        })

        return deepFreeze({
          record_id: recordId,
          project_id: validatedProjectId,
          schema_version: contractId,
          id: entityId,
          version: 1,
          payload: prepared.payload,
          payload_sha256: prepared.sha256,
          supersedes_ref: null,
          created_at: createdAt,
          created_by: { ...createdBy }
        }) as StoredMaterialsVersion<Name>
      })
    } catch (cause) {
      return rethrowOrWrap(cause, operation, projectId)
    }
  }

  read<Name extends MaterialsV1ContractName>(
    input: ReadMaterialsVersionInput<Name>
  ): StoredMaterialsVersion<Name> {
    const operation = 'read' as const
    let projectId: EntityId | null = null
    let ref: VersionRef | undefined
    try {
      if (!isRecord(input)) throw error('INVALID_ARGUMENT', operation, null, undefined)
      projectId = parseEntityId(input.projectId, operation, null)
      ref = parseVersionRef(input.ref, operation, projectId)
      this.#assertProjectExists(operation, projectId, ref)
      const raw = this.#selectExact(projectId, ref)
      if (raw === undefined) {
        throw error('VERSION_NOT_FOUND', operation, projectId, ref)
      }
      const decoded = decodePersistedRow(
        raw,
        operation,
        projectId,
        ref as VersionRef & Readonly<{ entity_type: Name }>
      )
      this.#assertLineage(decoded, operation)
      return decoded.stored
    } catch (cause) {
      return rethrowOrWrap(cause, operation, projectId, ref)
    }
  }

  list<Name extends MaterialsV1ContractName>(
    input: ListMaterialsVersionsInput<Name>
  ): MaterialsVersionPage<Name> {
    const operation = 'list' as const
    let projectId: EntityId | null = null
    try {
      if (!isRecord(input)) throw error('INVALID_ARGUMENT', operation, null, undefined)
      projectId = parseEntityId(input.projectId, operation, null)
      const contractId = parseContractId(input.contractId, operation, projectId) as Name
      const entityId = parseEntityId(input.entityId, operation, projectId)
      const beforeVersion =
        input.beforeVersion === undefined
          ? undefined
          : this.#parsePositiveInteger(input.beforeVersion, operation, projectId)
      const limit =
        input.limit === undefined
          ? DEFAULT_LIST_LIMIT
          : this.#parseListLimit(input.limit, operation, projectId)
      this.#assertProjectExists(operation, projectId)

      const parameters: unknown[] = [projectId, contractId, entityId]
      let cursorClause = ''
      if (beforeVersion !== undefined) {
        cursorClause = 'AND entity_revision < ?'
        parameters.push(beforeVersion)
      }
      parameters.push(limit + 1)
      const rows = this.#database
        .prepare(
          `SELECT ${VERSION_COLUMNS}
           FROM materials_object_versions
           WHERE project_id = ? AND contract_id = ? AND entity_id = ?
             ${cursorClause}
           ORDER BY entity_revision DESC
           LIMIT ?`
        )
        .all(...parameters)

      const decoded = rows.map((row) => {
        const value = decodePersistedRow<Name>(row, operation, projectId as EntityId)
        if (
          value.persisted.contractId !== contractId ||
          value.persisted.entityId !== entityId ||
          (beforeVersion !== undefined && value.persisted.revision >= beforeVersion)
        ) {
          throw error('STORAGE_CORRUPTION', operation, projectId, undefined)
        }
        return value
      })

      // Rows belong to one exact entity and are ordered newest-first. Validating the
      // newest row walks the same immutable predecessor chain through every older
      // page item, avoiding a repeated O(page * depth) traversal.
      if (decoded[0] !== undefined) this.#assertLineage(decoded[0], operation)

      const hasNextPage = decoded.length > limit
      const pageRows = hasNextPage ? decoded.slice(0, limit) : decoded
      const nextBeforeVersion = hasNextPage
        ? (pageRows.at(-1)?.persisted.revision ?? null)
        : null
      return deepFreeze({
        items: pageRows.map((row) => row.stored),
        nextBeforeVersion
      }) as MaterialsVersionPage<Name>
    } catch (cause) {
      return rethrowOrWrap(cause, operation, projectId)
    }
  }

  supersede<Name extends MaterialsV1ContractName>(
    input: SupersedeMaterialsVersionInput<Name>
  ): StoredMaterialsVersion<Name> {
    const operation = 'supersede' as const
    let projectId: EntityId | null = null
    let ref: VersionRef | undefined
    try {
      if (!isRecord(input)) throw error('INVALID_ARGUMENT', operation, null, undefined)
      projectId = parseEntityId(input.projectId, operation, null)
      ref = parseVersionRef(input.ref, operation, projectId)
      const validatedProjectId = projectId
      const currentRef = ref
      const contractId = currentRef.entity_type as Name
      const createdBy = parseActor(input.createdBy, operation, validatedProjectId, currentRef)
      if (!Number.isSafeInteger(currentRef.version + 1)) {
        throw error('INVALID_ARGUMENT', operation, validatedProjectId, currentRef)
      }
      const expectedHash = input.expectedPayloadSha256
      if (expectedHash !== undefined && !SHA256_PATTERN.test(expectedHash)) {
        throw error('INVALID_ARGUMENT', operation, validatedProjectId, currentRef)
      }
      const createdAt = parseTimestamp(
        input.createdAt ?? this.#now(),
        operation,
        validatedProjectId,
        currentRef
      )
      const recordId = parseEntityId(
        this.#generateRecordId(),
        operation,
        validatedProjectId,
        currentRef
      )
      const prepared = preparePayload(
        contractId,
        input.payload,
        {
          projectId: validatedProjectId,
          entityId: currentRef.entity_id,
          revision: currentRef.version + 1,
          createdAt,
          createdBy,
          predecessorEntityId: currentRef.entity_id
        },
        operation,
        currentRef
      )

      return this.#writeTransaction(operation, validatedProjectId, currentRef, () => {
        this.#assertProjectExists(operation, validatedProjectId, currentRef)
        const predecessorRaw = this.#selectExact(validatedProjectId, currentRef)
        if (predecessorRaw === undefined) {
          throw error('VERSION_NOT_FOUND', operation, validatedProjectId, currentRef)
        }
        const predecessor = decodePersistedRow(
          predecessorRaw,
          operation,
          validatedProjectId,
          currentRef as VersionRef & Readonly<{ entity_type: Name }>
        )
        this.#assertLineage(predecessor, operation)

        if (
          expectedHash !== undefined &&
          expectedHash !== predecessor.persisted.payloadSha256
        ) {
          throw error('VERSION_CONFLICT', operation, validatedProjectId, currentRef)
        }

        const children = this.#selectChildren(
          validatedProjectId,
          predecessor.persisted.recordId
        )
        if (children.length > 1) {
          throw error('STORAGE_CORRUPTION', operation, validatedProjectId, currentRef)
        }
        if (children.length === 1) {
          this.#decodeExpectedChild(children[0], predecessor, operation)
          throw error('VERSION_CONFLICT', operation, validatedProjectId, currentRef)
        }

        const later = this.#database
          .prepare(
            `SELECT record_id FROM materials_object_versions
             WHERE project_id = ? AND contract_id = ? AND entity_id = ?
               AND entity_revision > ?
             LIMIT 1`
          )
          .get(
            validatedProjectId,
            contractId,
            currentRef.entity_id,
            currentRef.version
          )
        if (later !== undefined) {
          throw error('STORAGE_CORRUPTION', operation, validatedProjectId, currentRef)
        }

        this.#assertRecordIdAvailable(operation, validatedProjectId, currentRef, recordId)
        this.#insert({
          recordId,
          projectId: validatedProjectId,
          contractId,
          entityId: currentRef.entity_id,
          revision: currentRef.version + 1,
          prepared,
          supersedesRecordId: predecessor.persisted.recordId,
          createdAt,
          createdBy
        })

        return deepFreeze({
          record_id: recordId,
          project_id: validatedProjectId,
          schema_version: contractId,
          id: currentRef.entity_id,
          version: currentRef.version + 1,
          payload: prepared.payload,
          payload_sha256: prepared.sha256,
          supersedes_ref: {
            entity_type: contractId,
            entity_id: currentRef.entity_id,
            version: currentRef.version
          },
          created_at: createdAt,
          created_by: { ...createdBy }
        }) as StoredMaterialsVersion<Name>
      })
    } catch (cause) {
      return rethrowOrWrap(cause, operation, projectId, ref)
    }
  }

  #parsePositiveInteger(
    value: unknown,
    operation: MaterialsVersionRepositoryOperation,
    projectId: EntityId
  ): number {
    const result = PositiveIntegerSchema.safeParse(value)
    if (!result.success || !Number.isSafeInteger(result.data)) {
      throw error('INVALID_ARGUMENT', operation, projectId, undefined, result.error)
    }
    return result.data
  }

  #parseListLimit(
    value: unknown,
    operation: MaterialsVersionRepositoryOperation,
    projectId: EntityId
  ): number {
    const limit = this.#parsePositiveInteger(value, operation, projectId)
    if (limit > MAX_LIST_LIMIT) {
      throw error('INVALID_ARGUMENT', operation, projectId, undefined)
    }
    return limit
  }

  #selectExact(projectId: EntityId, ref: VersionRef): unknown {
    return this.#database
      .prepare(
        `SELECT ${VERSION_COLUMNS}
         FROM materials_object_versions
         WHERE project_id = ? AND contract_id = ? AND entity_id = ? AND entity_revision = ?
         LIMIT 1`
      )
      .get(projectId, ref.entity_type, ref.entity_id, ref.version)
  }

  #selectChildren(projectId: EntityId, recordId: EntityId): unknown[] {
    return this.#database
      .prepare(
        `SELECT ${VERSION_COLUMNS}
         FROM materials_object_versions
         WHERE project_id = ? AND supersedes_record_id = ?
         ORDER BY record_id ASC`
      )
      .all(projectId, recordId)
  }

  #decodeExpectedChild(
    raw: unknown,
    parent: DecodedVersionRow,
    operation: 'read' | 'list' | 'supersede'
  ): DecodedVersionRow {
    const nextVersion = parent.persisted.revision + 1
    if (!Number.isSafeInteger(nextVersion)) {
      throw error(
        'STORAGE_CORRUPTION',
        operation,
        parent.persisted.projectId,
        {
          entity_type: parent.persisted.contractId,
          entity_id: parent.persisted.entityId,
          version: parent.persisted.revision
        }
      )
    }
    const expectedRef: VersionRef = {
      entity_type: parent.persisted.contractId,
      entity_id: parent.persisted.entityId,
      version: nextVersion
    }
    const child = decodePersistedRow(
      raw,
      operation,
      parent.persisted.projectId,
      expectedRef as VersionRef & Readonly<{ entity_type: MaterialsV1ContractName }>
    )
    if (child.persisted.supersedesRecordId !== parent.persisted.recordId) {
      throw error('STORAGE_CORRUPTION', operation, parent.persisted.projectId, expectedRef)
    }
    return child
  }

  #assertLineage(
    requested: DecodedVersionRow,
    operation: 'read' | 'list' | 'supersede'
  ): void {
    const { projectId, contractId, entityId, revision } = requested.persisted
    const requestedRef: VersionRef = {
      entity_type: contractId,
      entity_id: entityId,
      version: revision
    }
    const ancestorRows = this.#database
      .prepare(
        `SELECT ${VERSION_COLUMNS}
         FROM materials_object_versions
         WHERE project_id = ? AND contract_id = ? AND entity_id = ?
           AND entity_revision <= ?
         ORDER BY entity_revision DESC`
      )
      .all(projectId, contractId, entityId, revision)

    if (ancestorRows.length !== revision) {
      throw error('STORAGE_CORRUPTION', operation, projectId, requestedRef)
    }

    const ancestors = ancestorRows.map((row, index) => {
      const expectedRef: VersionRef = {
        entity_type: contractId,
        entity_id: entityId,
        version: revision - index
      }
      return decodePersistedRow(
        row,
        operation,
        projectId,
        expectedRef as VersionRef & Readonly<{ entity_type: MaterialsV1ContractName }>
      )
    })
    if (ancestors[0]?.persisted.recordId !== requested.persisted.recordId) {
      throw error('STORAGE_CORRUPTION', operation, projectId, requestedRef)
    }

    for (let index = 0; index < ancestors.length; index += 1) {
      const current = ancestors[index]
      const predecessor = ancestors[index + 1]
      if (
        predecessor === undefined
          ? current.persisted.revision !== 1 || current.persisted.supersedesRecordId !== null
          : current.persisted.supersedesRecordId !== predecessor.persisted.recordId
      ) {
        throw error('STORAGE_CORRUPTION', operation, projectId, requestedRef)
      }
    }

    const parentByRecordId = new Map(
      ancestors.map((ancestor) => [ancestor.persisted.recordId, ancestor] as const)
    )
    const childrenByParent = new Map<EntityId, DecodedVersionRow[]>()
    const childRows = this.#database
      .prepare(
        `SELECT ${CHILD_VERSION_COLUMNS}
         FROM materials_object_versions AS child
         INNER JOIN materials_object_versions AS parent
           ON parent.project_id = child.project_id
          AND parent.record_id = child.supersedes_record_id
         WHERE parent.project_id = ? AND parent.contract_id = ? AND parent.entity_id = ?
           AND parent.entity_revision <= ?
         ORDER BY parent.entity_revision DESC, child.record_id ASC`
      )
      .all(projectId, contractId, entityId, revision)

    for (const row of childRows) {
      const child = decodePersistedRow(row, operation, projectId)
      const parentId = child.persisted.supersedesRecordId
      const parent = parentId === null ? undefined : parentByRecordId.get(parentId)
      if (
        parent === undefined ||
        child.persisted.contractId !== contractId ||
        child.persisted.entityId !== entityId ||
        child.persisted.revision !== parent.persisted.revision + 1
      ) {
        throw error('STORAGE_CORRUPTION', operation, projectId, requestedRef)
      }
      const siblings = childrenByParent.get(parentId as EntityId) ?? []
      siblings.push(child)
      childrenByParent.set(parentId as EntityId, siblings)
    }

    for (let index = 0; index < ancestors.length; index += 1) {
      const parent = ancestors[index]
      const children = childrenByParent.get(parent.persisted.recordId) ?? []
      if (children.length > 1) {
        throw error('STORAGE_CORRUPTION', operation, projectId, requestedRef)
      }
      const expectedChild = ancestors[index - 1]
      if (
        expectedChild !== undefined &&
        (children.length !== 1 ||
          children[0].persisted.recordId !== expectedChild.persisted.recordId)
      ) {
        throw error('STORAGE_CORRUPTION', operation, projectId, requestedRef)
      }
    }
  }

  #assertProjectExists(
    operation: MaterialsVersionRepositoryOperation,
    projectId: EntityId,
    ref?: VersionRef
  ): void {
    const project = this.#database
      .prepare('SELECT project_id FROM materials_projects WHERE project_id = ? LIMIT 1')
      .get(projectId)
    if (project === undefined) {
      throw error('PROJECT_NOT_FOUND', operation, projectId, ref)
    }
  }

  #assertRecordIdAvailable(
    operation: 'create' | 'supersede',
    projectId: EntityId,
    ref: VersionRef | undefined,
    recordId: EntityId
  ): void {
    const existing = this.#database
      .prepare('SELECT record_id FROM materials_object_versions WHERE record_id = ? LIMIT 1')
      .get(recordId)
    if (existing !== undefined) {
      throw error('RECORD_ID_COLLISION', operation, projectId, ref)
    }
  }

  #insert<Name extends MaterialsV1ContractName>(input: {
    recordId: EntityId
    projectId: EntityId
    contractId: Name
    entityId: EntityId
    revision: number
    prepared: PreparedPayload<Name>
    supersedesRecordId: EntityId | null
    createdAt: IsoDateTime
    createdBy: ActorRef
  }): void {
    this.#database
      .prepare(
        `INSERT INTO materials_object_versions (
           record_id,
           project_id,
           contract_id,
           entity_id,
           entity_revision,
           payload_json,
           payload_sha256,
           supersedes_record_id,
           created_at,
           created_by_kind,
           created_by_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.recordId,
        input.projectId,
        input.contractId,
        input.entityId,
        input.revision,
        input.prepared.json,
        input.prepared.sha256,
        input.supersedesRecordId,
        input.createdAt,
        input.createdBy.kind,
        input.createdBy.id
      )
  }

  #writeTransaction<Result>(
    operation: 'create' | 'supersede',
    projectId: EntityId,
    ref: VersionRef | undefined,
    callback: () => Result
  ): Result {
    let started = false
    try {
      this.#database.exec('BEGIN IMMEDIATE')
      started = true
      const result = callback()
      this.#database.exec('COMMIT')
      started = false
      return result
    } catch (cause) {
      let rollbackCause: unknown
      if (started) {
        try {
          this.#database.exec('ROLLBACK')
        } catch (rollbackError) {
          rollbackCause = rollbackError
        }
      }
      if (cause instanceof MaterialsVersionRepositoryError && rollbackCause === undefined) {
        throw cause
      }
      throw error(
        'STORAGE_FAILURE',
        operation,
        projectId,
        ref,
        rollbackCause === undefined ? cause : { cause, rollbackCause }
      )
    }
  }
}

export function createMaterialsVersionRepository(
  database: MaterialsVersionSqliteDatabase,
  options: MaterialsVersionRepositoryOptions = {}
): MaterialsVersionRepository {
  return new MaterialsVersionRepository(database, options)
}
