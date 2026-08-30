// ============================================================================
// Локальная БД приложения (T1.1).
//
// Единая SQLite-база `%APPDATA%/flow/flow.db` (режим WAL) — фундамент для памяти
// доски (T1.1), кэша LLM (T3.4), персистентных ранов (T1.5), глобального поиска (T4.1).
//
// В этой задаче используются таблицы:
//   board_memory  — выжимки памяти доски (день/неделя/месяц);
//   board_meta    — пер-борд флаги (таймлайн и пр.);
//   memory_fts    — FTS5-индекс по контенту выжимок (+ триггеры синхронизации).
//   materials_projects        — проекты профиля materials_rnd;
//   materials_object_versions — неизменяемые версии доменных payload.
//
// Надёжность: повреждение/отсутствие flow.db не роняет приложение — файл
// бэкапится и пересоздаётся, ошибка пишется в лог, статус доступен через getDbStatus().
// ============================================================================
import Database from 'better-sqlite3'
import type { Database as BetterSqlite3Database, Statement } from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, renameSync } from 'fs'
import { applyDatabaseMigrations, DatabaseMigrationError } from './db/migrations'

export type PeriodKind = 'day' | 'week' | 'month'

export type MemoryEntry = {
  boardId: string
  periodKind: PeriodKind
  periodKey: string
  content: string
  createdAt: number
  updatedAt: number
}

export type MemorySearchHit = MemoryEntry & { snippet: string }

export type DbStatus = { ok: boolean; recreated: boolean; error?: string }

function nowMs(): number {
  return Date.now()
}

function dbDir(): string {
  return app.getPath('userData')
}
function dbPath(): string {
  return join(dbDir(), 'flow.db')
}
function backupDir(): string {
  const d = join(dbDir(), 'backup')
  try {
    if (!existsSync(d)) mkdirSync(d, { recursive: true })
  } catch {
    /* ignore */
  }
  return d
}

let db: BetterSqlite3Database | null = null
let status: DbStatus = { ok: false, recreated: false }

function assertDatabaseIntegrity(d: BetterSqlite3Database): void {
  const result = d.pragma('quick_check', { simple: true }) as string
  if (result !== 'ok') throw new Error(`integrity check: ${result}`)
}

function openFresh(path: string): BetterSqlite3Database {
  const d = new Database(path)
  try {
    d.pragma('journal_mode = WAL')
    d.pragma('synchronous = NORMAL')
    d.pragma('foreign_keys = ON')
    // Physical corruption must be classified before migration SQL can wrap it as a
    // DatabaseMigrationError. That keeps the existing backup/recovery path available.
    assertDatabaseIntegrity(d)
    applyDatabaseMigrations(d)
    // A second check verifies the fully migrated database before it becomes observable.
    assertDatabaseIntegrity(d)
    return d
  } catch (error) {
    try {
      d.close()
    } catch {
      /* ignore close failure while preserving the original error */
    }
    throw error
  }
}

/** Открыть БД (лениво). Повреждённый файл бэкапится и БД пересоздаётся. */
export function getDb(): BetterSqlite3Database {
  if (db) return db
  const path = dbPath()
  try {
    db = openFresh(path)
    status = { ok: true, recreated: false }
    return db
  } catch (e) {
    const msg = String((e as Error)?.message || e)
    if (e instanceof DatabaseMigrationError) {
      status = { ok: false, recreated: false, error: msg }
      console.error('[db] Миграция БД не выполнена; исходный файл сохранён:', msg)
      throw e
    }
    // Попытка восстановления: увести повреждённый файл в backup/ и создать заново.
    try {
      if (existsSync(path)) {
        const stamp = new Date(nowMs()).toISOString().replace(/[:.]/g, '-')
        const dest = join(backupDir(), `flow.corrupt-${stamp}.db`)
        try {
          renameSync(path, dest)
        } catch {
          /* WAL/SHM могут держаться — игнорируем, откроем заново поверх */
        }
        // Сопутствующие WAL/SHM удаляем вместе с базой (переносить их не обязательно).
        for (const suf of ['-wal', '-shm']) {
          try {
            if (existsSync(path + suf)) renameSync(path + suf, dest + suf)
          } catch {
            /* ignore */
          }
        }
      }
      db = openFresh(path)
      status = { ok: true, recreated: true, error: msg }
      console.error('[db] БД была повреждена/недоступна, пересоздана заново:', msg)
      return db
    } catch (e2) {
      status = { ok: false, recreated: false, error: String((e2 as Error)?.message || e2) }
      console.error('[db] Не удалось открыть/пересоздать БД:', status.error)
      throw e2
    }
  }
}

export function getDbStatus(): DbStatus {
  // Гарантируем попытку открытия, чтобы статус отражал реальность.
  if (!db && status.ok === false && !status.error) {
    try {
      getDb()
    } catch {
      /* статус уже выставлен */
    }
  }
  return status
}

export function closeDb(): void {
  if (!db) return
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    /* ignore */
  }
  try {
    db.close()
  } catch {
    /* ignore */
  }
  db = null
}

// --- Подготовленные стейтменты (лениво, после открытия БД) ---
type Stmts = {
  list: Statement
  get: Statement
  upsert: Statement
  del: Statement
  metaGet: Statement
  metaSet: Statement
  metaAll: Statement
}
let stmts: Stmts | null = null
function s(): Stmts {
  const d = getDb()
  if (stmts) return stmts
  stmts = {
    list: d.prepare(
      'SELECT board_id, period_kind, period_key, content, created_at, updated_at FROM board_memory WHERE board_id = ? ORDER BY period_key ASC, period_kind ASC'
    ),
    get: d.prepare(
      'SELECT board_id, period_kind, period_key, content, created_at, updated_at FROM board_memory WHERE board_id = ? AND period_kind = ? AND period_key = ?'
    ),
    upsert: d.prepare(`
      INSERT INTO board_memory (board_id, period_kind, period_key, content, created_at, updated_at)
      VALUES (@boardId, @periodKind, @periodKey, @content, @createdAt, @updatedAt)
      ON CONFLICT(board_id, period_kind, period_key)
      DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
    `),
    del: d.prepare('DELETE FROM board_memory WHERE board_id = ? AND period_kind = ? AND period_key = ?'),
    metaGet: d.prepare('SELECT value FROM board_meta WHERE board_id = ? AND key = ?'),
    metaSet: d.prepare(`
      INSERT INTO board_meta (board_id, key, value) VALUES (?, ?, ?)
      ON CONFLICT(board_id, key) DO UPDATE SET value = excluded.value
    `),
    metaAll: d.prepare('SELECT key, value FROM board_meta WHERE board_id = ?')
  }
  return stmts
}

function rowToEntry(r: {
  board_id: string
  period_kind: string
  period_key: string
  content: string
  created_at: number
  updated_at: number
}): MemoryEntry {
  return {
    boardId: r.board_id,
    periodKind: (r.period_kind as PeriodKind) || 'day',
    periodKey: r.period_key,
    content: r.content,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

// --- Публичный API памяти доски ---
export function memoryList(boardId: string): MemoryEntry[] {
  return (s().list.all(boardId) as Parameters<typeof rowToEntry>[0][]).map(rowToEntry)
}

export function memoryGet(boardId: string, periodKind: PeriodKind, periodKey: string): MemoryEntry | null {
  const r = s().get.get(boardId, periodKind, periodKey) as Parameters<typeof rowToEntry>[0] | undefined
  return r ? rowToEntry(r) : null
}

export function memoryUpsert(input: {
  boardId: string
  periodKind: PeriodKind
  periodKey: string
  content: string
  createdAt?: number
  updatedAt?: number
}): MemoryEntry {
  const existing = memoryGet(input.boardId, input.periodKind, input.periodKey)
  const createdAt = existing?.createdAt ?? input.createdAt ?? nowMs()
  const updatedAt = input.updatedAt ?? nowMs()
  s().upsert.run({
    boardId: input.boardId,
    periodKind: input.periodKind,
    periodKey: input.periodKey,
    content: input.content,
    createdAt,
    updatedAt
  })
  return { boardId: input.boardId, periodKind: input.periodKind, periodKey: input.periodKey, content: input.content, createdAt, updatedAt }
}

export function memoryDelete(boardId: string, periodKind: PeriodKind, periodKey: string): { ok: true; deleted: number } {
  const info = s().del.run(boardId, periodKind, periodKey)
  return { ok: true, deleted: info.changes }
}

// FTS5-запрос из пользовательского текста: разбиваем на токены, экранируем кавычки,
// каждый — префиксное совпадение. Пустой/битый запрос → пусто, вызов не падает.
function toFtsQuery(query: string): string {
  const tokens = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2)
  if (!tokens.length) return ''
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' ')
}

export function memorySearch(query: string, opts?: { boardId?: string; limit?: number }): MemorySearchHit[] {
  const q = (query || '').trim()
  if (!q) return []
  const limit = Math.max(1, Math.min(200, opts?.limit ?? 50))
  const d = getDb()
  const fts = toFtsQuery(q)
  const rows: (Parameters<typeof rowToEntry>[0] & { snippet: string })[] = []
  // 1) FTS по словам/префиксам.
  if (fts) {
    try {
      const sql = `
        SELECT bm.board_id, bm.period_kind, bm.period_key, bm.content, bm.created_at, bm.updated_at,
               snippet(memory_fts, 0, '[', ']', '…', 12) AS snippet
        FROM memory_fts
        JOIN board_memory bm ON bm.id = memory_fts.rowid
        WHERE memory_fts MATCH ?${opts?.boardId ? ' AND bm.board_id = ?' : ''}
        ORDER BY rank
        LIMIT ?`
      const args: unknown[] = opts?.boardId ? [fts, opts.boardId, limit] : [fts, limit]
      rows.push(...(d.prepare(sql).all(...args) as typeof rows))
    } catch {
      /* битый MATCH — уйдём в LIKE-фолбэк ниже */
    }
  }
  // 2) LIKE-фолбэк на подстроку (если FTS ничего не дал), чтобы ловить и части слов.
  if (!rows.length) {
    const like = `%${q.replace(/[%_\\]/g, (m) => '\\' + m)}%`
    const sql = `
      SELECT board_id, period_kind, period_key, content, created_at, updated_at,
             substr(content, 1, 160) AS snippet
      FROM board_memory
      WHERE content LIKE ? ESCAPE '\\'${opts?.boardId ? ' AND board_id = ?' : ''}
      ORDER BY updated_at DESC
      LIMIT ?`
    const args: unknown[] = opts?.boardId ? [like, opts.boardId, limit] : [like, limit]
    rows.push(...(d.prepare(sql).all(...args) as typeof rows))
  }
  return rows.map((r) => ({ ...rowToEntry(r), snippet: r.snippet }))
}

// --- board_meta ---
export function boardMetaGet(boardId: string, key: string): string | null {
  const r = s().metaGet.get(boardId, key) as { value: string } | undefined
  return r ? r.value : null
}
export function boardMetaGetAll(boardId: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of s().metaAll.all(boardId) as { key: string; value: string }[]) out[r.key] = r.value
  return out
}
export function boardMetaSet(boardId: string, key: string, value: string): { ok: true } {
  s().metaSet.run(boardId, key, value)
  return { ok: true }
}

// --- Эмбеддинги памяти доски (T2.4) ---
export type MemEmbItem = { periodKind: PeriodKind; periodKey: string; vector: number[] }

function vecToBlob(v: number[]): Buffer {
  return Buffer.from(new Float32Array(v).buffer)
}
function blobToVec(b: Buffer): number[] {
  return Array.from(new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4)))
}

export function memEmbList(boardId: string): MemEmbItem[] {
  const rows = getDb()
    .prepare('SELECT period_kind, period_key, vector FROM memory_embeddings WHERE board_id = ?')
    .all(boardId) as { period_kind: string; period_key: string; vector: Buffer }[]
  return rows.map((r) => ({ periodKind: (r.period_kind as PeriodKind) || 'day', periodKey: r.period_key, vector: blobToVec(r.vector) }))
}

export function memEmbSet(boardId: string, periodKind: PeriodKind, periodKey: string, vector: number[]): { ok: true } {
  getDb()
    .prepare(
      `INSERT INTO memory_embeddings (board_id, period_kind, period_key, vector, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(board_id, period_kind, period_key) DO UPDATE SET vector = excluded.vector, updated_at = excluded.updated_at`
    )
    .run(boardId, periodKind, periodKey, vecToBlob(vector), nowMs())
  return { ok: true }
}

export function memEmbDelete(boardId: string, periodKind: PeriodKind, periodKey: string): { ok: true } {
  getDb().prepare('DELETE FROM memory_embeddings WHERE board_id = ? AND period_kind = ? AND period_key = ?').run(boardId, periodKind, periodKey)
  return { ok: true }
}

// --- Глобальный поиск по нодам (T4.1) ---
export type NodeIndexItem = { shapeId: string; kind: string; title: string; body: string }
export type NodeSearchHit = {
  boardId: string
  boardName: string
  shapeId: string
  kind: string
  title: string
  snippet: string
}

/** Переиндексировать доску целиком: удалить старые строки board_id и вставить актуальные. */
export function nodesReindexBoard(boardId: string, boardName: string, nodes: NodeIndexItem[]): { ok: true; count: number } {
  const d = getDb()
  const del = d.prepare('DELETE FROM nodes_fts WHERE board_id = ?')
  const ins = d.prepare(
    'INSERT INTO nodes_fts (board_id, board_name, shape_id, kind, title, body) VALUES (?, ?, ?, ?, ?, ?)'
  )
  const tx = d.transaction(() => {
    del.run(boardId)
    for (const n of nodes) {
      if (!n || !n.shapeId) continue
      ins.run(boardId, boardName || '', n.shapeId, n.kind || '', n.title || '', n.body || '')
    }
  })
  tx()
  return { ok: true, count: nodes.length }
}

export function nodesDeleteBoard(boardId: string): { ok: true } {
  getDb().prepare('DELETE FROM nodes_fts WHERE board_id = ?').run(boardId)
  return { ok: true }
}

export function nodesSearch(query: string, opts?: { limit?: number }): NodeSearchHit[] {
  const q = (query || '').trim()
  if (!q) return []
  const limit = Math.max(1, Math.min(200, opts?.limit ?? 50))
  const d = getDb()
  const fts = toFtsQuery(q)
  const rows: (Omit<NodeSearchHit, 'snippet'> & { snippet: string })[] = []
  if (fts) {
    try {
      const sql = `
        SELECT board_id AS boardId, board_name AS boardName, shape_id AS shapeId, kind, title,
               snippet(nodes_fts, 5, '[', ']', '…', 12) AS snippet
        FROM nodes_fts
        WHERE nodes_fts MATCH ?
        ORDER BY rank
        LIMIT ?`
      rows.push(...(d.prepare(sql).all(fts, limit) as typeof rows))
    } catch {
      /* уйдём в LIKE-фолбэк */
    }
  }
  if (!rows.length) {
    const like = `%${q.replace(/[%_\\]/g, (m) => '\\' + m)}%`
    const sql = `
      SELECT board_id AS boardId, board_name AS boardName, shape_id AS shapeId, kind, title,
             substr(body, 1, 160) AS snippet
      FROM nodes_fts
      WHERE title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\'
      LIMIT ?`
    rows.push(...(d.prepare(sql).all(like, like, limit) as typeof rows))
  }
  return rows
}

// --- Одноразовая миграция из localStorage (T1.1) ---
export type LocalMemoryDump = {
  memory: { boardId: string; periodKind: PeriodKind; periodKey: string; content: string; ts?: number }[]
  meta: { boardId: string; key: string; value: string }[]
}

/**
 * Импорт данных, собранных renderer'ом из localStorage. Идемпотентно (upsert),
 * поэтому повторный вызов не плодит дубли. rawDump сохраняется renderer'ом в backup/
 * ещё до вызова — тут только запись в БД.
 */
export function importLocalDump(dump: LocalMemoryDump): { ok: true; memory: number; meta: number } {
  const d = getDb()
  const tx = d.transaction(() => {
    for (const m of dump.memory) {
      if (!m.boardId || !m.periodKey || typeof m.content !== 'string') continue
      memoryUpsert({
        boardId: m.boardId,
        periodKind: m.periodKind || 'day',
        periodKey: m.periodKey,
        content: m.content,
        createdAt: m.ts,
        updatedAt: m.ts
      })
    }
    for (const mt of dump.meta) {
      if (!mt.boardId || !mt.key) continue
      boardMetaSet(mt.boardId, mt.key, String(mt.value ?? ''))
    }
  })
  tx()
  return { ok: true, memory: dump.memory.length, meta: dump.meta.length }
}
