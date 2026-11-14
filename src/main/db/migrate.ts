import type { Db } from './connection'
import { MIGRATIONS, type Migration } from './migrations'

/** Applies pending migrations in order. Returns the resulting schema version. */
export function migrate(db: Db, migrations: readonly Migration[] = MIGRATIONS): number {
  let current = db.pragma<number>('user_version') ?? 0
  const latest = migrations.reduce((max, m) => Math.max(max, m.version), 0)
  if (current > latest) {
    throw new Error(
      `Database schema version ${current} is newer than this app supports (${latest}). Please update the app.`,
    )
  }
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (m.version <= current) continue
    db.transaction(() => {
      db.exec(m.sql)
      // PRAGMA does not accept bound parameters; version is a trusted integer.
      db.exec(`PRAGMA user_version = ${Math.trunc(m.version)}`)
    })
    current = m.version
  }
  return current
}
