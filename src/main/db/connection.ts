// Thin wrapper around the SQLite driver. All DB access in the app goes through `Db` so the
// driver (currently Node's built-in `node:sqlite`) can be swapped without touching repos.

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite'

export type SqlValue = string | number | bigint | null | Uint8Array
export type SqlParams = SqlValue[] | Record<string, SqlValue>
export type Row = Record<string, SqlValue>

export interface Db {
  /** Run one or more statements with no parameters / results. */
  exec(sql: string): void
  run(sql: string, params?: SqlParams): { changes: number }
  get<T = Row>(sql: string, params?: SqlParams): T | undefined
  all<T = Row>(sql: string, params?: SqlParams): T[]
  /** Runs `fn` in a transaction (nested calls use savepoints). Rolls back on throw. */
  transaction<T>(fn: () => T): T
  pragma<T = SqlValue>(name: string): T | undefined
  /** Writes a consistent snapshot of the database to `path` (VACUUM INTO). */
  backupTo(path: string): void
  close(): void
  readonly path: string
}

export interface OpenDbOptions {
  /** `:memory:` for tests. */
  path: string
}

class NodeSqliteDb implements Db {
  private readonly db: DatabaseSync
  private readonly cache = new Map<string, StatementSync>()
  private depth = 0

  constructor(readonly path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path, { enableForeignKeyConstraints: true })
    if (path !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA synchronous = NORMAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec('PRAGMA busy_timeout = 5000')
  }

  private stmt(sql: string): StatementSync {
    let s = this.cache.get(sql)
    if (!s) {
      s = this.db.prepare(sql)
      this.cache.set(sql, s)
    }
    return s
  }

  private static bind(
    stmt: StatementSync,
    params: SqlParams | undefined,
    method: 'run' | 'get' | 'all',
  ) {
    if (params === undefined) return stmt[method]()
    if (Array.isArray(params)) return stmt[method](...(params as SQLInputValue[]))
    return stmt[method](params as Record<string, SQLInputValue>)
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  run(sql: string, params?: SqlParams): { changes: number } {
    const r = NodeSqliteDb.bind(this.stmt(sql), params, 'run') as { changes: number | bigint }
    return { changes: Number(r.changes) }
  }

  get<T = Row>(sql: string, params?: SqlParams): T | undefined {
    return NodeSqliteDb.bind(this.stmt(sql), params, 'get') as T | undefined
  }

  all<T = Row>(sql: string, params?: SqlParams): T[] {
    return NodeSqliteDb.bind(this.stmt(sql), params, 'all') as T[]
  }

  transaction<T>(fn: () => T): T {
    const sp = `sp_${this.depth}`
    const outer = this.depth === 0
    this.db.exec(outer ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`)
    this.depth++
    try {
      const result = fn()
      this.depth--
      this.db.exec(outer ? 'COMMIT' : `RELEASE ${sp}`)
      return result
    } catch (err) {
      this.depth--
      this.db.exec(outer ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`)
      throw err
    }
  }

  pragma<T = SqlValue>(name: string): T | undefined {
    const row = this.db.prepare(`PRAGMA ${name}`).get() as Row | undefined
    if (!row) return undefined
    return Object.values(row)[0] as T
  }

  backupTo(path: string): void {
    mkdirSync(dirname(path), { recursive: true })
    // VACUUM INTO produces a consistent, compacted snapshot even while in WAL mode.
    this.db.prepare('VACUUM INTO ?').run(path)
  }

  close(): void {
    this.cache.clear()
    if (this.db.isOpen) this.db.close()
  }
}

export function openDb(options: OpenDbOptions): Db {
  return new NodeSqliteDb(options.path)
}
