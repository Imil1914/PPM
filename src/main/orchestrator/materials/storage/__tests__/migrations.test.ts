import { createHash } from 'node:crypto'
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyDatabaseMigrations,
  DATABASE_MIGRATIONS,
  DatabaseMigrationError,
  type SqliteMigration
} from '../../../../db/migrations'
import {
  MATERIALS_DB_SCHEMA_VERSION,
  MATERIALS_SCHEMA_V4_MIGRATION
} from '../migrations'

type MigrationRow = { version: number; applied_at: number }
type SqliteMasterRow = { name: string; sql: string | null }
type IndexListRow = { name: string; unique: number }
type IndexInfoRow = { seqno: number; name: string }
type ForeignKeyRow = {
  table: string
  from: string
  to: string
  on_update: string
  on_delete: string
}

const LEGACY_APPLIED_AT = 1_700_000_000_000
const MATERIALS_APPLIED_AT = 1_700_000_000_004
const DEFAULT_HASH = 'a'.repeat(64)

let temporaryRoot = ''
const openDatabases = new Set<DatabaseSync>()

beforeEach(() => {
  temporaryRoot = mkdtempSync(join(tmpdir(), 'antyflow-materials-migrations-'))
})

afterEach(() => {
  for (const database of openDatabases) {
    try {
      database.close()
    } catch {
      // The assertion that failed may already have closed the database.
    }
  }
  openDatabases.clear()
  rmSync(temporaryRoot, { recursive: true, force: true })
})

function openDatabase(name: string): DatabaseSync {
  const database = new DatabaseSync(join(temporaryRoot, name))
  database.exec('PRAGMA foreign_keys = ON;')
  openDatabases.add(database)
  return database
}

function closeDatabase(database: DatabaseSync): void {
  database.close()
  openDatabases.delete(database)
}

function databasePath(name: string): string {
  return join(temporaryRoot, name)
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function migrationHistory(database: DatabaseSync): MigrationRow[] {
  return database
    .prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version')
    .all()
    .map((row) => ({
      version: Number(row.version),
      applied_at: Number(row.applied_at)
    }))
}

function sqliteObject(
  database: DatabaseSync,
  type: 'table' | 'trigger',
  name: string
): SqliteMasterRow | undefined {
  const row = database
    .prepare('SELECT name, sql FROM sqlite_master WHERE type = ? AND name = ?')
    .get(type, name)
  if (!row) return undefined
  return { name: String(row.name), sql: row.sql === null ? null : String(row.sql) }
}

function tableExists(database: DatabaseSync, name: string): boolean {
  return sqliteObject(database, 'table', name) !== undefined
}

function quoteSqlIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

function indexColumns(database: DatabaseSync, table: string): string[][] {
  const indices = database
    .prepare(`PRAGMA index_list(${quoteSqlIdentifier(table)})`)
    .all() as IndexListRow[]

  return indices.map(({ name }) =>
    (database
      .prepare(`PRAGMA index_info(${quoteSqlIdentifier(name)})`)
      .all() as IndexInfoRow[])
      .sort((left, right) => left.seqno - right.seqno)
      .map((row) => row.name)
  )
}

function hasIndexPrefix(allColumns: string[][], prefix: string[]): boolean {
  return allColumns.some(
    (columns) =>
      columns.length >= prefix.length &&
      prefix.every((column, index) => columns[index] === column)
  )
}

function applyThroughV3(database: DatabaseSync): void {
  applyDatabaseMigrations(
    database,
    DATABASE_MIGRATIONS.filter((migration) => migration.version <= 3),
    () => LEGACY_APPLIED_AT
  )
}

function seedLegacyMemory(database: DatabaseSync, content = 'legacy memory survives'): void {
  database
    .prepare(
      `INSERT INTO board_memory
        (board_id, period_kind, period_key, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run('legacy-board', 'day', '2026-08-28', content, 100, 200)
  database
    .prepare('INSERT INTO board_meta (board_id, key, value) VALUES (?, ?, ?)')
    .run('legacy-board', 'timeline', 'enabled')
}

function insertProject(
  database: DatabaseSync,
  projectId: string,
  boardId = `${projectId}-board`,
  workflowProfile = 'materials_rnd'
): void {
  database
    .prepare(
      `INSERT INTO materials_projects (
         project_id,
         board_id,
         workflow_profile,
         status,
         created_at,
         updated_at,
         created_by_kind,
         created_by_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      projectId,
      boardId,
      workflowProfile,
      'draft',
      '2026-08-28T00:00:00.000Z',
      '2026-08-28T00:00:00.000Z',
      'engineer',
      'engineer-fixture'
    )
}

type VersionInsert = {
  recordId: string
  projectId?: string
  contractId?: string
  entityId?: string
  entityRevision?: number
  payloadJson?: string
  payloadSha256?: string
  supersedesRecordId?: string | null
}

function insertVersion(database: DatabaseSync, input: VersionInsert): void {
  database
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
      input.projectId ?? 'project-a',
      input.contractId ?? 'ResearchGoalV1',
      input.entityId ?? 'goal-a',
      input.entityRevision ?? 1,
      input.payloadJson ?? '{"schema_version":"ResearchGoalV1"}',
      input.payloadSha256 ?? DEFAULT_HASH,
      input.supersedesRecordId ?? null,
      '2026-08-28T00:00:00.000Z',
      'system',
      'migration-fixture'
    )
}

describe('SQLite migration manifest', () => {
  it('is the single continuous manifest 1..4 and reuses the normative v4 descriptor', () => {
    expect(MATERIALS_DB_SCHEMA_VERSION).toBe(4)
    expect(DATABASE_MIGRATIONS.map((migration) => migration.version)).toEqual([1, 2, 3, 4])
    expect(new Set(DATABASE_MIGRATIONS.map((migration) => migration.name)).size).toBe(4)
    expect(DATABASE_MIGRATIONS.at(-1)).toBe(MATERIALS_SCHEMA_V4_MIGRATION)
  })

  it.each([
    ['duplicate', () => [...DATABASE_MIGRATIONS, MATERIALS_SCHEMA_V4_MIGRATION]],
    ['gap', () => DATABASE_MIGRATIONS.filter((migration) => migration.version !== 2)]
  ])('rejects a %s manifest before materials writes', (_caseName, createManifest) => {
    const database = openDatabase(`invalid-manifest-${_caseName}.db`)

    expect(() => applyDatabaseMigrations(database, createManifest())).toThrow(
      DatabaseMigrationError
    )
    expect(tableExists(database, 'materials_projects')).toBe(false)
    expect(tableExists(database, 'materials_object_versions')).toBe(false)
  })

  it('rejects applied history with a gap before materials writes', () => {
    const database = openDatabase('history-gap.db')
    database.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO schema_migrations(version, applied_at) VALUES (1, 100), (3, 300);
    `)

    expect(() => applyDatabaseMigrations(database)).toThrow(DatabaseMigrationError)
    expect(migrationHistory(database).map((row) => row.version)).toEqual([1, 3])
    expect(tableExists(database, 'materials_projects')).toBe(false)
  })

  it('rejects a database from an unknown future schema version', () => {
    const database = openDatabase('future-version.db')
    database.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO schema_migrations(version, applied_at)
      VALUES (1, 100), (2, 200), (3, 300), (4, 400), (5, 500);
    `)

    expect(() => applyDatabaseMigrations(database)).toThrow(DatabaseMigrationError)
    expect(migrationHistory(database).map((row) => row.version)).toEqual([1, 2, 3, 4, 5])
    expect(tableExists(database, 'materials_projects')).toBe(false)
  })
})

describe('fresh and existing SQLite databases', () => {
  it('opens a fresh physical database through migrations 1..4', () => {
    const database = openDatabase('fresh.db')

    applyDatabaseMigrations(database, DATABASE_MIGRATIONS, () => MATERIALS_APPLIED_AT)

    expect(migrationHistory(database)).toEqual(
      [1, 2, 3, 4].map((version) => ({ version, applied_at: MATERIALS_APPLIED_AT }))
    )
    for (const legacyTable of [
      'board_memory',
      'board_meta',
      'memory_fts',
      'nodes_fts',
      'memory_embeddings'
    ]) {
      expect(tableExists(database, legacyTable), legacyTable).toBe(true)
    }
    expect(tableExists(database, 'materials_projects')).toBe(true)
    expect(tableExists(database, 'materials_object_versions')).toBe(true)
    expect(database.prepare('PRAGMA quick_check').get()).toMatchObject({ quick_check: 'ok' })
  })

  it('upgrades a physical v3 copy without changing legacy rows or markers 1..3', () => {
    const source = openDatabase('existing-v3.db')
    applyThroughV3(source)
    seedLegacyMemory(source)
    const historyBefore = migrationHistory(source)
    closeDatabase(source)

    copyFileSync(databasePath('existing-v3.db'), databasePath('existing-v3-copy.db'))
    const copy = openDatabase('existing-v3-copy.db')
    applyDatabaseMigrations(copy, DATABASE_MIGRATIONS, () => MATERIALS_APPLIED_AT)

    expect(migrationHistory(copy).slice(0, 3)).toEqual(historyBefore)
    expect(migrationHistory(copy).at(-1)).toEqual({
      version: 4,
      applied_at: MATERIALS_APPLIED_AT
    })
    expect(
      copy
        .prepare(
          'SELECT content, created_at, updated_at FROM board_memory WHERE board_id = ? AND period_key = ?'
        )
        .get('legacy-board', '2026-08-28')
    ).toMatchObject({ content: 'legacy memory survives', created_at: 100, updated_at: 200 })
    expect(
      copy.prepare('SELECT value FROM board_meta WHERE board_id = ? AND key = ?').get(
        'legacy-board',
        'timeline'
      )
    ).toMatchObject({ value: 'enabled' })
    expect(copy.prepare('PRAGMA quick_check').get()).toMatchObject({ quick_check: 'ok' })
  })

  it('is idempotent and preserves every original applied_at value', () => {
    const database = openDatabase('idempotent.db')
    applyDatabaseMigrations(database, DATABASE_MIGRATIONS, () => MATERIALS_APPLIED_AT)
    const firstHistory = migrationHistory(database)

    applyDatabaseMigrations(database, DATABASE_MIGRATIONS, () => MATERIALS_APPLIED_AT + 999)

    expect(migrationHistory(database)).toEqual(firstHistory)
  })
})

describe('materials schema v4', () => {
  it('creates the project/history indices, project FK and append-only triggers', () => {
    const database = openDatabase('schema-v4.db')
    applyDatabaseMigrations(database)

    const projectIndices = indexColumns(database, 'materials_projects')
    const versionIndices = indexColumns(database, 'materials_object_versions')
    expect(hasIndexPrefix(projectIndices, ['board_id'])).toBe(true)
    expect(
      hasIndexPrefix(versionIndices, [
        'project_id',
        'contract_id',
        'entity_id',
        'entity_revision'
      ])
    ).toBe(true)
    expect(hasIndexPrefix(versionIndices, ['project_id', 'supersedes_record_id'])).toBe(true)
    expect(hasIndexPrefix(versionIndices, ['payload_sha256'])).toBe(true)

    const foreignKeys = database
      .prepare('PRAGMA foreign_key_list(materials_object_versions)')
      .all() as ForeignKeyRow[]
    expect(foreignKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: 'materials_projects',
          from: 'project_id',
          to: 'project_id',
          on_update: 'RESTRICT',
          on_delete: 'RESTRICT'
        })
      ])
    )

    const triggers = database
      .prepare(
        `SELECT name, sql FROM sqlite_master
         WHERE type = 'trigger' AND tbl_name = 'materials_object_versions'
         ORDER BY name`
      )
      .all() as SqliteMasterRow[]
    expect(triggers.length).toBeGreaterThanOrEqual(2)
    expect(triggers.some((trigger) => /before\s+update/i.test(trigger.sql ?? ''))).toBe(true)
    expect(triggers.some((trigger) => /before\s+delete/i.test(trigger.sql ?? ''))).toBe(true)
  })

  it('enforces JSON-object, revision, VersionRef, project, predecessor and hash constraints', () => {
    const database = openDatabase('constraints-v4.db')
    applyDatabaseMigrations(database)
    insertProject(database, 'project-a')
    insertProject(database, 'project-b')

    expect(() => insertProject(database, 'project-generic', 'board-generic', 'generic')).toThrow()
    expect(() =>
      insertVersion(database, { recordId: 'bad-json', payloadJson: '{not-json' })
    ).toThrow()
    expect(() =>
      insertVersion(database, { recordId: 'json-array', payloadJson: '[]' })
    ).toThrow()
    expect(() =>
      insertVersion(database, { recordId: 'revision-zero', entityRevision: 0 })
    ).toThrow()
    expect(() =>
      insertVersion(database, { recordId: 'revision-fractional', entityRevision: 1.5 })
    ).toThrow()
    expect(() =>
      insertVersion(database, { recordId: 'bad-hash-short', payloadSha256: 'a'.repeat(63) })
    ).toThrow()
    expect(() =>
      insertVersion(database, { recordId: 'bad-hash-uppercase', payloadSha256: 'A'.repeat(64) })
    ).toThrow()
    expect(() =>
      insertVersion(database, { recordId: 'unknown-project', projectId: 'missing-project' })
    ).toThrow()
    expect(() =>
      insertVersion(database, {
        recordId: 'broken-predecessor',
        supersedesRecordId: 'missing-record'
      })
    ).toThrow()
    expect(() =>
      insertVersion(database, {
        recordId: 'self-predecessor',
        supersedesRecordId: 'self-predecessor'
      })
    ).toThrow()

    insertVersion(database, { recordId: 'record-a1' })
    expect(() =>
      insertVersion(database, {
        recordId: 'duplicate-version-ref',
        entityRevision: 1
      })
    ).toThrow()
    expect(() =>
      insertVersion(database, {
        recordId: 'cross-project-predecessor',
        projectId: 'project-b',
        entityId: 'goal-b',
        entityRevision: 2,
        supersedesRecordId: 'record-a1'
      })
    ).toThrow()

    insertVersion(database, {
      recordId: 'record-a2',
      entityRevision: 2,
      supersedesRecordId: 'record-a1'
    })
    expect(
      database
        .prepare(
          'SELECT record_id, supersedes_record_id FROM materials_object_versions ORDER BY entity_revision'
        )
        .all()
    ).toEqual([
      expect.objectContaining({ record_id: 'record-a1', supersedes_record_id: null }),
      expect.objectContaining({ record_id: 'record-a2', supersedes_record_id: 'record-a1' })
    ])
  })

  it('rejects UPDATE and DELETE of a persisted version row', () => {
    const database = openDatabase('append-only-v4.db')
    applyDatabaseMigrations(database)
    insertProject(database, 'project-a')
    insertVersion(database, { recordId: 'immutable-record' })

    expect(() =>
      database
        .prepare('UPDATE materials_object_versions SET payload_json = ? WHERE record_id = ?')
        .run('{"changed":true}', 'immutable-record')
    ).toThrow()
    expect(() =>
      database
        .prepare('DELETE FROM materials_object_versions WHERE record_id = ?')
        .run('immutable-record')
    ).toThrow()
    expect(
      database
        .prepare('SELECT payload_json FROM materials_object_versions WHERE record_id = ?')
        .get('immutable-record')
    ).toMatchObject({ payload_json: '{"schema_version":"ResearchGoalV1"}' })
    expect(() =>
      database.prepare('DELETE FROM materials_projects WHERE project_id = ?').run('project-a')
    ).toThrow()
  })
})

describe('physical-copy rollback rehearsal', () => {
  it('rolls back failed DDL, DML and marker on the copy while leaving the source byte-identical', () => {
    const sourcePath = databasePath('rollback-source-v3.db')
    const copyPath = databasePath('rollback-copy.db')
    const source = openDatabase('rollback-source-v3.db')
    applyThroughV3(source)
    seedLegacyMemory(source, 'source remains immutable')
    closeDatabase(source)
    const sourceHashBefore = sha256File(sourcePath)
    copyFileSync(sourcePath, copyPath)

    const failureCause = new Error('fixture migration failed after DDL and DML')
    const failingMigration: SqliteMigration = {
      version: 4,
      name: 'fixture-failing-v4',
      up: (database) => {
        database.exec(`
          CREATE TABLE rollback_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
          INSERT INTO rollback_probe(id, value) VALUES (1, 'must disappear');
          INSERT INTO board_memory
            (board_id, period_kind, period_key, content, created_at, updated_at)
          VALUES ('rollback-probe-board', 'day', 'probe', 'must disappear', 1, 1);
        `)
        throw failureCause
      }
    }
    const copy = openDatabase('rollback-copy.db')
    let thrown: unknown
    try {
      applyDatabaseMigrations(
        copy,
        [...DATABASE_MIGRATIONS.filter((migration) => migration.version <= 3), failingMigration],
        () => MATERIALS_APPLIED_AT
      )
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(DatabaseMigrationError)
    expect(thrown).toMatchObject({
      migrationVersion: 4,
      migrationName: 'fixture-failing-v4'
    })
    expect((thrown as Error & { cause?: unknown }).cause).toBe(failureCause)
    expect(tableExists(copy, 'rollback_probe')).toBe(false)
    expect(migrationHistory(copy).map((row) => row.version)).toEqual([1, 2, 3])
    expect(
      copy
        .prepare('SELECT COUNT(*) AS count FROM board_memory WHERE board_id = ?')
        .get('rollback-probe-board')
    ).toMatchObject({ count: 0 })
    closeDatabase(copy)

    expect(sha256File(sourcePath)).toBe(sourceHashBefore)
    const reopenedSource = openDatabase('rollback-source-v3.db')
    expect(migrationHistory(reopenedSource).map((row) => row.version)).toEqual([1, 2, 3])
    expect(
      reopenedSource
        .prepare('SELECT content FROM board_memory WHERE board_id = ?')
        .get('legacy-board')
    ).toMatchObject({ content: 'source remains immutable' })
  })
})
