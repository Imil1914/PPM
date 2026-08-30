import { MATERIALS_SCHEMA_V4_MIGRATION } from '../orchestrator/materials/storage/migrations'

export interface SqliteMigrationStatement {
  all(): unknown[]
}

export interface SqliteMigrationDatabase {
  exec(sql: string): unknown
  prepare(sql: string): SqliteMigrationStatement
}

export interface SqliteMigration {
  version: number
  name: string
  up(db: SqliteMigrationDatabase): void
}

interface DatabaseMigrationErrorOptions {
  migrationVersion: number | null
  migrationName: string
  cause: unknown
}

export class DatabaseMigrationError extends Error {
  readonly migrationVersion: number | null
  readonly migrationName: string
  override readonly cause: unknown

  constructor(message: string, options: DatabaseMigrationErrorOptions) {
    super(message, { cause: options.cause })
    this.name = 'DatabaseMigrationError'
    this.migrationVersion = options.migrationVersion
    this.migrationName = options.migrationName
    this.cause = options.cause
  }
}

const LEGACY_DATABASE_MIGRATIONS: readonly SqliteMigration[] = [
  {
    version: 1,
    name: 'board-memory-and-meta',
    up: (d) => {
      d.exec(`
        CREATE TABLE IF NOT EXISTS board_memory (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          board_id    TEXT NOT NULL,
          period_kind TEXT NOT NULL DEFAULT 'day',
          period_key  TEXT NOT NULL,
          content     TEXT NOT NULL,
          created_at  INTEGER NOT NULL,
          updated_at  INTEGER NOT NULL,
          UNIQUE(board_id, period_kind, period_key)
        );
        CREATE INDEX IF NOT EXISTS idx_board_memory_board ON board_memory(board_id, period_key);

        CREATE TABLE IF NOT EXISTS board_meta (
          board_id TEXT NOT NULL,
          key      TEXT NOT NULL,
          value    TEXT NOT NULL,
          PRIMARY KEY (board_id, key)
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts
          USING fts5(content, content='board_memory', content_rowid='id');

        CREATE TRIGGER IF NOT EXISTS board_memory_ai AFTER INSERT ON board_memory BEGIN
          INSERT INTO memory_fts(rowid, content) VALUES (new.id, new.content);
        END;
        CREATE TRIGGER IF NOT EXISTS board_memory_ad AFTER DELETE ON board_memory BEGIN
          INSERT INTO memory_fts(memory_fts, rowid, content) VALUES ('delete', old.id, old.content);
        END;
        CREATE TRIGGER IF NOT EXISTS board_memory_au AFTER UPDATE ON board_memory BEGIN
          INSERT INTO memory_fts(memory_fts, rowid, content) VALUES ('delete', old.id, old.content);
          INSERT INTO memory_fts(rowid, content) VALUES (new.id, new.content);
        END;
      `)
    }
  },
  {
    // T4.1: глобальный поиск по нодам всех досок. Отдельная (не external-content) FTS5:
    // переиндексация доски = DELETE по board_id + INSERT — простая инвалидация удалённых нод.
    version: 2,
    name: 'global-node-search',
    up: (d) => {
      d.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
          board_id UNINDEXED,
          board_name UNINDEXED,
          shape_id UNINDEXED,
          kind,
          title,
          body,
          tokenize='unicode61 remove_diacritics 2'
        );
      `)
    }
  },
  {
    // T2.4: эмбеддинги выжимок памяти доски (для retrieval вместо «вся память в контекст»).
    version: 3,
    name: 'memory-embeddings',
    up: (d) => {
      d.exec(`
        CREATE TABLE IF NOT EXISTS memory_embeddings (
          board_id    TEXT NOT NULL,
          period_kind TEXT NOT NULL,
          period_key  TEXT NOT NULL,
          vector      BLOB NOT NULL,
          updated_at  INTEGER NOT NULL,
          PRIMARY KEY (board_id, period_kind, period_key)
        );
      `)
    }
  }
]

export const DATABASE_MIGRATIONS: readonly SqliteMigration[] = Object.freeze([
  ...LEGACY_DATABASE_MIGRATIONS,
  MATERIALS_SCHEMA_V4_MIGRATION
])

function migrationError(
  message: string,
  migrationVersion: number | null,
  migrationName: string,
  cause: unknown
): DatabaseMigrationError {
  return new DatabaseMigrationError(message, { migrationVersion, migrationName, cause })
}

function validateManifest(migrations: readonly SqliteMigration[]): void {
  if (migrations.length === 0) {
    throw migrationError('Database migration manifest must not be empty', null, 'manifest', 'empty manifest')
  }

  for (let index = 0; index < migrations.length; index += 1) {
    const migration = migrations[index]
    const expectedVersion = index + 1
    if (!Number.isSafeInteger(migration.version) || migration.version !== expectedVersion) {
      throw migrationError(
        `Database migration manifest must be the continuous sequence 1..N; expected ${expectedVersion}, got ${String(migration.version)}`,
        Number.isSafeInteger(migration.version) ? migration.version : null,
        migration.name || 'manifest',
        new Error('invalid migration version sequence')
      )
    }
    if (typeof migration.name !== 'string' || migration.name.trim().length === 0) {
      throw migrationError(
        `Database migration ${migration.version} must have a non-empty name`,
        migration.version,
        'manifest',
        new Error('invalid migration name')
      )
    }
    if (typeof migration.up !== 'function') {
      throw migrationError(
        `Database migration ${migration.version} (${migration.name}) must define up()`,
        migration.version,
        migration.name,
        new Error('missing migration up function')
      )
    }
  }
}

function readAppliedVersions(db: SqliteMigrationDatabase): number[] {
  let rows: unknown[]
  try {
    rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version ASC').all()
  } catch (cause) {
    throw migrationError(
      'Unable to read database migration history',
      null,
      'schema-history',
      cause
    )
  }

  return rows.map((row, index) => {
    if (typeof row !== 'object' || row === null || !('version' in row)) {
      throw migrationError(
        `Invalid database migration history row at index ${index}`,
        null,
        'schema-history',
        new Error('history row has no version')
      )
    }
    const version = (row as { version: unknown }).version
    if (!Number.isSafeInteger(version) || (version as number) < 1) {
      throw migrationError(
        `Invalid applied database migration version: ${String(version)}`,
        typeof version === 'number' ? version : null,
        'schema-history',
        new Error('history version must be a positive safe integer')
      )
    }
    return version as number
  })
}

function validateHistory(appliedVersions: readonly number[], migrations: readonly SqliteMigration[]): void {
  const latestKnownVersion = migrations.length

  for (let index = 0; index < appliedVersions.length; index += 1) {
    const version = appliedVersions[index]
    const expectedVersion = index + 1
    if (version > latestKnownVersion) {
      throw migrationError(
        `Database schema version ${version} is newer than supported version ${latestKnownVersion}`,
        version,
        'schema-history',
        new Error('unknown future database schema version')
      )
    }
    if (version !== expectedVersion) {
      throw migrationError(
        `Database migration history has a gap; expected ${expectedVersion}, got ${version}`,
        version,
        'schema-history',
        new Error('non-contiguous database migration history')
      )
    }
  }
}

export function applyDatabaseMigrations(
  db: SqliteMigrationDatabase,
  migrations: readonly SqliteMigration[] = DATABASE_MIGRATIONS,
  now: () => number = Date.now
): void {
  validateManifest(migrations)

  try {
    db.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);'
    )
  } catch (cause) {
    throw migrationError(
      'Unable to initialize database migration history',
      null,
      'schema-history',
      cause
    )
  }

  const appliedVersions = readAppliedVersions(db)
  validateHistory(appliedVersions, migrations)
  const applied = new Set(appliedVersions)

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue

    let transactionStarted = false
    try {
      db.exec('BEGIN IMMEDIATE')
      transactionStarted = true
      migration.up(db)

      const appliedAt = now()
      if (!Number.isSafeInteger(appliedAt) || appliedAt < 0) {
        throw new Error(`Migration clock returned invalid timestamp: ${String(appliedAt)}`)
      }
      db.exec(
        `INSERT INTO schema_migrations(version, applied_at) VALUES (${migration.version}, ${appliedAt})`
      )
      db.exec('COMMIT')
      transactionStarted = false
      applied.add(migration.version)
    } catch (cause) {
      let rollbackCause: unknown
      if (transactionStarted) {
        try {
          db.exec('ROLLBACK')
        } catch (error) {
          rollbackCause = error
        }
      }

      const rollbackSuffix = rollbackCause
        ? `; rollback also failed: ${String((rollbackCause as Error)?.message || rollbackCause)}`
        : ''
      throw migrationError(
        `Database migration ${migration.version} (${migration.name}) failed${rollbackSuffix}`,
        migration.version,
        migration.name,
        cause
      )
    }
  }
}
