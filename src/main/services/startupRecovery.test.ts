// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, SchemaTooNewError } from '../db'
import { migrate } from '../db/migrate'
import { takeBackup } from './backup'
import {
  classifyOpenError,
  newestBackup,
  restoreBackup,
  startupDialogSpec,
  type StartupDialogSpec,
} from './startupRecovery'

const ids = (spec: StartupDialogSpec): string[] => spec.buttons.map((b) => b.id)
const backup = { createdAt: new Date(2026, 10, 1, 9, 30).getTime() }

describe('classifyOpenError', () => {
  it('recognises a database from a newer app version', () => {
    const r = openDatabase({ path: ':memory:' })
    r.db.exec('PRAGMA user_version = 999')
    let err: unknown
    try {
      migrate(r.db)
    } catch (e) {
      err = e
    }
    r.db.close()
    expect(err).toBeInstanceOf(SchemaTooNewError)
    expect(classifyOpenError(err)).toBe('newer_version')
  })

  it('recognises a locked file and treats everything else as corrupt/unreadable', () => {
    const busy = Object.assign(new Error('database is locked'), { errcode: 5 })
    expect(classifyOpenError(busy)).toBe('locked')
    expect(classifyOpenError(Object.assign(new Error('x'), { errcode: 6 }))).toBe('locked')
    const notDb = Object.assign(new Error('file is not a database'), { errcode: 26 })
    expect(classifyOpenError(notDb)).toBe('corrupt')
    expect(classifyOpenError(new Error('EACCES: permission denied'))).toBe('corrupt')
  })

  it('a garbage file fails to open as "corrupt"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mt-corrupt-'))
    const file = join(dir, 'todos.db')
    writeFileSync(file, 'not sqlite at all '.repeat(100))
    let err: unknown
    try {
      openDatabase({ path: file }).db.close()
    } catch (e) {
      err = e
    }
    expect(classifyOpenError(err)).toBe('corrupt')
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('startupDialogSpec', () => {
  const dir = '/data'
  const failed = (cause: 'newer_version' | 'locked' | 'corrupt') =>
    ({ kind: 'open_failed', cause, error: 'boom' }) as const

  it('newer version: explains it and never offers a restore', () => {
    const spec = startupDialogSpec(failed('newer_version'), backup, dir)
    expect(spec.message).toMatch(/created by a newer version of Martin's To Dos/)
    expect(ids(spec)).toEqual(['reveal', 'quit'])
    expect(spec.buttons[spec.cancelId]?.id).toBe('quit')
  })

  it('corrupt: offers restore (default) only when a backup exists', () => {
    const withBackup = startupDialogSpec(failed('corrupt'), backup, dir)
    expect(withBackup.message).toMatch(/can't read your data file/)
    expect(ids(withBackup)).toEqual(['reveal', 'restore', 'quit'])
    expect(withBackup.buttons[withBackup.defaultId]?.id).toBe('restore')
    expect(withBackup.buttons[withBackup.cancelId]?.id).toBe('quit')
    expect(withBackup.detail).toContain('boom')

    const none = startupDialogSpec(failed('corrupt'), null, dir)
    expect(ids(none)).toEqual(['reveal', 'quit'])
    expect(none.buttons[none.defaultId]?.id).toBe('quit')
  })

  it('locked: says another program has the file', () => {
    const spec = startupDialogSpec(failed('locked'), backup, dir)
    expect(spec.message).toMatch(/another program is using the file/)
    expect(ids(spec)).toEqual(['reveal', 'restore', 'quit'])
    expect(ids(startupDialogSpec(failed('locked'), null, dir))).toEqual(['reveal', 'quit'])
  })

  it('missing database with backups: restore / start fresh / quit', () => {
    const spec = startupDialogSpec({ kind: 'missing_db' }, backup, dir)
    expect(ids(spec)).toEqual(['restore', 'fresh', 'quit'])
    expect(spec.buttons[spec.defaultId]?.id).toBe('restore')
    expect(spec.buttons[spec.cancelId]?.id).toBe('quit')
  })
})

describe('restoreBackup', () => {
  let dir: string
  let dataDir: string
  let backupsDir: string
  let dbFile: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mt-restore-'))
    dataDir = join(dir, 'data')
    backupsDir = join(dir, 'backups')
    dbFile = join(dataDir, 'todos.db')
    mkdirSync(dataDir, { recursive: true })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function makeBackup(title: string, now: number): string {
    const src = openDatabase({ path: join(dir, `src-${now}.db`) })
    src.tasks.create({ title })
    const path = takeBackup(src.db, backupsDir, { now })
    src.db.close()
    return path
  }

  it('moves the broken db and its -wal/-shm aside (never deletes) and copies the newest backup in', () => {
    makeBackup('older', new Date(2026, 0, 1).getTime())
    makeBackup('newest', new Date(2026, 0, 2).getTime())
    writeFileSync(dbFile, 'garbage')
    writeFileSync(`${dbFile}-wal`, 'wal bytes')
    writeFileSync(`${dbFile}-shm`, 'shm bytes')

    const latest = newestBackup(backupsDir)
    expect(latest?.name).toBe('todos-20260102-000000.db')
    const now = new Date(2026, 10, 13, 20, 15, 3).getTime()
    const res = restoreBackup(dbFile, latest?.path ?? '', now)

    const base = `${dbFile}.broken-20261113-201503`
    expect(res.movedAside).toEqual([base, `${base}-wal`, `${base}-shm`])
    expect(readdirSync(dataDir).sort()).toEqual(
      [
        'todos.db',
        'todos.db.broken-20261113-201503',
        'todos.db.broken-20261113-201503-shm',
        'todos.db.broken-20261113-201503-wal',
      ].sort(),
    )
    const restored = openDatabase({ path: dbFile })
    expect(restored.tasks.list().map((t) => t.title)).toEqual(['newest'])
    restored.db.close()
  })

  it('works when there is no database file (or data folder) at all and never overwrites an earlier broken copy', () => {
    const b = makeBackup('only', new Date(2026, 0, 1).getTime())
    rmSync(dataDir, { recursive: true, force: true })
    expect(restoreBackup(dbFile, b).movedAside).toEqual([])
    expect(existsSync(dbFile)).toBe(true)

    const now = new Date(2026, 10, 13, 8).getTime()
    writeFileSync(dbFile, 'garbage 1')
    restoreBackup(dbFile, b, now)
    writeFileSync(dbFile, 'garbage 2')
    const second = restoreBackup(dbFile, b, now)
    expect(second.movedAside).toEqual([`${dbFile}.broken-20261113-080000-1`])
    expect(readdirSync(dataDir).filter((n) => n.includes('broken'))).toHaveLength(2)
  })

  it('newestBackup skips backups that already failed', () => {
    const a = makeBackup('a', new Date(2026, 0, 1).getTime())
    const b = makeBackup('b', new Date(2026, 0, 2).getTime())
    expect(newestBackup(backupsDir)?.path).toBe(b)
    expect(newestBackup(backupsDir, new Set([b]))?.path).toBe(a)
    expect(newestBackup(backupsDir, new Set([a, b]))).toBeNull()
  })
})
