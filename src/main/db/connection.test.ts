// @vitest-environment node
import { openDb, type Db } from './connection'

let db: Db

beforeEach(() => {
  db = openDb({ path: ':memory:' })
  db.exec('CREATE TABLE p (id TEXT PRIMARY KEY); CREATE TABLE c (pid TEXT REFERENCES p(id))')
})
afterEach(() => db.close())

const count = (table: string): number =>
  db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)?.n ?? -1

/** A transaction whose body succeeds but whose COMMIT fails (deferred FK violation). */
function failAtCommit(): void {
  db.transaction(() => {
    db.exec('PRAGMA defer_foreign_keys = ON')
    db.run('INSERT INTO c VALUES (?)', ['missing'])
  })
}

describe('Db.transaction', () => {
  it('stays usable after a COMMIT failure', () => {
    expect(failAtCommit).toThrow(/FOREIGN KEY/)
    expect(count('c')).toBe(0)
    db.transaction(() => db.run('INSERT INTO p VALUES (?)', ['a']))
    db.transaction(() => db.run('INSERT INTO p VALUES (?)', ['b']))
    expect(count('p')).toBe(2)
    // Nested transactions still use valid savepoint names.
    db.transaction(() => db.transaction(() => db.run('INSERT INTO p VALUES (?)', ['c'])))
    expect(count('p')).toBe(3)
  })

  it('rolls back a nested failure to its savepoint and keeps the outer work', () => {
    db.transaction(() => {
      db.run('INSERT INTO p VALUES (?)', ['outer'])
      expect(() =>
        db.transaction(() => {
          db.run('INSERT INTO p VALUES (?)', ['inner'])
          throw new Error('inner boom')
        }),
      ).toThrow('inner boom')
    })
    expect(db.all<{ id: string }>('SELECT id FROM p').map((r) => r.id)).toEqual(['outer'])
    db.transaction(() => db.run('INSERT INTO p VALUES (?)', ['after']))
    expect(count('p')).toBe(2)
  })

  it('rolls everything back when a nested failure propagates', () => {
    expect(() =>
      db.transaction(() => {
        db.run('INSERT INTO p VALUES (?)', ['outer'])
        db.transaction(() => {
          db.run('INSERT INTO p VALUES (?)', ['inner'])
          throw new Error('propagated')
        })
      }),
    ).toThrow('propagated')
    expect(count('p')).toBe(0)
    db.transaction(() => db.run('INSERT INTO p VALUES (?)', ['ok']))
    expect(count('p')).toBe(1)
  })

  it('a nested COMMIT-time failure surfaces at the outer COMMIT and leaves the Db usable', () => {
    expect(() =>
      db.transaction(() => {
        db.transaction(() => {
          db.exec('PRAGMA defer_foreign_keys = ON')
          db.run('INSERT INTO c VALUES (?)', ['missing'])
        })
      }),
    ).toThrow(/FOREIGN KEY/)
    expect(count('c')).toBe(0)
    db.transaction(() => db.transaction(() => db.run('INSERT INTO p VALUES (?)', ['ok'])))
    expect(count('p')).toBe(1)
  })

  it('reports the original error when SQLite already rolled back (rollback itself fails)', () => {
    expect(() =>
      db.transaction(() => {
        db.exec('ROLLBACK') // the transaction is gone; our ROLLBACK would now error
        throw new Error('original')
      }),
    ).toThrow('original')
    db.transaction(() => db.run('INSERT INTO p VALUES (?)', ['ok']))
    expect(count('p')).toBe(1)
  })

  it('reports the original error when a nested savepoint is gone', () => {
    expect(() =>
      db.transaction(() => {
        db.transaction(() => {
          db.exec('ROLLBACK') // drops the outer transaction and with it our savepoint
          throw new Error('nested original')
        })
      }),
    ).toThrow('nested original')
    db.transaction(() => db.run('INSERT INTO p VALUES (?)', ['ok']))
    expect(count('p')).toBe(1)
  })
})
