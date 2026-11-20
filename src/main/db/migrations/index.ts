import { sql as m001 } from './001_initial'
import { sql as m002 } from './002_started_at'

export interface Migration {
  version: number
  name: string
  sql: string
}

/**
 * Ordered list of migrations. Append only — never edit a shipped migration.
 * Each runs in its own transaction and bumps `PRAGMA user_version`.
 */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'initial', sql: m001 },
  { version: 2, name: 'started_at', sql: m002 },
]
