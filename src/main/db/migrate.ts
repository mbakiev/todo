import type { Db } from './connection'
import { MIGRATIONS, type Migration } from './migrations'

/** The database was written by a newer app version (its schema is ahead of ours). */
export class SchemaTooNewError extends Error {
  constructor(
    readonly dbVersion: number,
    readonly appVersion: number,
  ) {
    super(
      `Database schema version ${dbVersion} is newer than this app supports (${appVersion}). Please update the app.`,
    )
    this.name = 'SchemaTooNewError'
  }
}

/** Applies pending migrations in order. Returns the resulting schema version. */
export function migrate(db: Db, migrations: readonly Migration[] = MIGRATIONS): number {
  let current = db.pragma<number>('user_version') ?? 0
  const latest = migrations.reduce((max, m) => Math.max(max, m.version), 0)
  if (current > latest) {
    throw new SchemaTooNewError(current, latest)
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
