// @vitest-environment node
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { openDatabase, SchemaTooNewError } from '../db'
import { migrate } from '../db/migrate'
import { takeBackup } from './backup'
import {
  classifyOpenError,
  explainOpenError,
  MoveAsideError,
  newestBackup,
  openDatabaseWithRecoveryFlow,
  restoreBackup,
  startupDialogSpec,
  type RecoveryDeps,
  type StartupChoice,
  type StartupDialogSpec,
} from './startupRecovery'

/**
 * Makes `file` impossible to rename until the returned function is called. POSIX: a read-only
 * parent folder. Windows ignores folder permission bits; there, hold the file open the way
 * another SQLite program (e.g. DB Browser) would: SQLite opens files without
 * FILE_SHARE_DELETE, so renaming fails while the app can still open (and read) the file.
 */
function blockRename(dir: string, file: string): () => void {
  if (process.platform === 'win32') {
    const holder = new DatabaseSync(file)
    return () => holder.close()
  }
  chmodSync(dir, 0o555)
  return () => chmodSync(dir, 0o755)
}

/**
 * Windows only: opens `file` the way a program that does not share it does (CreateFile with no
 * share flags; some backup / sync tools, antivirus, editors). libuv's UV_FS_O_EXLOCK, which
 * Node does not export as a constant. Returns the fd to close.
 */
function holdExclusively(file: string): number {
  const UV_FS_O_EXLOCK = 0x10000000
  return openSync(file, constants.O_RDWR | UV_FS_O_EXLOCK)
}

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

describe('explainOpenError', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mt-explain-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('leaves other errors, and "unable to open" on a file nobody holds, unchanged', () => {
    const file = join(dir, 'todos.db')
    writeFileSync(file, '')
    const notDb = Object.assign(new Error('file is not a database'), { errcode: 26 })
    expect(explainOpenError(notDb, file)).toBe(notDb)
    const cantOpen = Object.assign(new Error('unable to open database file'), { errcode: 14 })
    expect(explainOpenError(cantOpen, file)).toBe(cantOpen)
    expect(explainOpenError(cantOpen, join(dir, 'missing.db'))).toBe(cantOpen)
  })

  it.skipIf(process.platform !== 'win32')(
    'a file another program holds without sharing it (Windows) is "locked", not "corrupt"',
    () => {
      const file = join(dir, 'todos.db')
      openDatabase({ path: file }).db.close()
      const fd = holdExclusively(file)
      try {
        let err: unknown
        try {
          openDatabase({ path: file }).db.close()
        } catch (e) {
          err = e
        }
        // SQLite itself only says SQLITE_CANTOPEN.
        expect((err as { errcode?: unknown }).errcode).toBe(14)
        expect(classifyOpenError(err)).toBe('corrupt')
        expect(classifyOpenError(explainOpenError(err, file))).toBe('locked')
      } finally {
        closeSync(fd)
      }
    },
  )

  it.skipIf(process.platform !== 'win32')('a held -wal file (Windows) is "locked" as well', () => {
    const file = join(dir, 'todos.db')
    writeFileSync(file, '')
    writeFileSync(`${file}-wal`, '')
    const cantOpen = Object.assign(new Error('unable to open database file'), { errcode: 14 })
    const fd = holdExclusively(`${file}-wal`)
    try {
      expect(classifyOpenError(explainOpenError(cantOpen, file))).toBe('locked')
    } finally {
      closeSync(fd)
    }
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

  it('locked: Try again / Reveal data folder / Quit, never a restore', () => {
    const spec = startupDialogSpec(failed('locked'), backup, dir)
    expect(spec.message).toMatch(/another program is using the file/)
    expect(ids(spec)).toEqual(['retry', 'reveal', 'quit'])
    expect(spec.buttons[spec.defaultId]?.id).toBe('retry')
    expect(spec.buttons[spec.cancelId]?.id).toBe('quit')
    expect(spec.detail).not.toMatch(/restor/i)
    expect(ids(startupDialogSpec(failed('locked'), null, dir))).toEqual(['retry', 'reveal', 'quit'])
  })

  it('a notice (why the last attempt failed) leads the detail', () => {
    const spec = startupDialogSpec(
      { ...failed('corrupt'), notice: 'Could not move it.' },
      backup,
      dir,
    )
    expect(spec.detail.startsWith('Could not move it.')).toBe(true)
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

  it('if any file cannot be moved aside, puts back what moved and says so plainly', () => {
    const b = makeBackup('only', new Date(2026, 0, 1).getTime())
    writeFileSync(dbFile, 'garbage')
    writeFileSync(`${dbFile}-wal`, 'wal bytes')
    const now = new Date(2026, 10, 13, 8).getTime()
    // Something already occupies the -wal target (a non-empty folder): that rename fails.
    mkdirSync(join(`${dbFile}.broken-20261113-080000-wal`, 'x'), { recursive: true })
    let err: unknown
    try {
      restoreBackup(dbFile, b, now)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(MoveAsideError)
    expect((err as Error).message).toMatch(/couldn't be moved aside.*Nothing has been changed/)
    // Back exactly as it was.
    expect(existsSync(dbFile)).toBe(true)
    expect(existsSync(`${dbFile}-wal`)).toBe(true)
    expect(existsSync(`${dbFile}.broken-20261113-080000`)).toBe(false)
  })

  it('newestBackup skips backups that already failed', () => {
    const a = makeBackup('a', new Date(2026, 0, 1).getTime())
    const b = makeBackup('b', new Date(2026, 0, 2).getTime())
    expect(newestBackup(backupsDir)?.path).toBe(b)
    expect(newestBackup(backupsDir, new Set([b]))?.path).toBe(a)
    expect(newestBackup(backupsDir, new Set([a, b]))).toBeNull()
  })
})

describe('openDatabaseWithRecoveryFlow', () => {
  const lockedError = Object.assign(new Error('database is locked'), { errcode: 5 })
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mt-flow-'))
    mkdirSync(join(dir, 'data'), { recursive: true })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function deps(
    open: () => string,
    answers: StartupChoice[],
  ): RecoveryDeps<string> & { asked: StartupDialogSpec[]; reveals: number } {
    const asked: StartupDialogSpec[] = []
    const d = {
      dbFile: join(dir, 'data', 'todos.db'),
      backupsDir: join(dir, 'backups'),
      dataDir: join(dir, 'data'),
      open,
      asked,
      reveals: 0,
      ask: async (spec: StartupDialogSpec) => {
        asked.push(spec)
        return answers.shift() ?? 'quit'
      },
      reveal: async () => {
        d.reveals++
      },
      restoreFailed: vi.fn(),
      exists: () => true,
      hasBackups: () => false,
    }
    return d
  }

  it('locked: "Try again" re-attempts the open, as often as needed', async () => {
    let attempts = 0
    const d = deps(() => {
      if (++attempts < 4) throw lockedError
      return 'repos'
    }, ['retry', 'retry', 'retry'])
    expect(await openDatabaseWithRecoveryFlow(d)).toBe('repos')
    expect(attempts).toBe(4)
    expect(d.asked.map((s) => ids(s))).toEqual([
      ['retry', 'reveal', 'quit'],
      ['retry', 'reveal', 'quit'],
      ['retry', 'reveal', 'quit'],
    ])
  })

  it('locked: Reveal shows the folder and asks again; Quit quits', async () => {
    const d = deps(() => {
      throw lockedError
    }, ['reveal', 'quit'])
    expect(await openDatabaseWithRecoveryFlow(d)).toBeNull()
    expect(d.reveals).toBe(1)
    expect(d.asked).toHaveLength(2)
  })

  it.skipIf(process.platform !== 'win32')(
    'locked (Windows): a file held without sharing offers Try again, not restore',
    async () => {
      const dbFile = join(dir, 'data', 'todos.db')
      openDatabase({ path: dbFile }).db.close()
      let fd: number | null = holdExclusively(dbFile)
      const d = deps(() => {
        openDatabase({ path: dbFile }).db.close()
        return 'repos'
      }, ['retry'])
      const ask = d.ask
      d.ask = async (spec) => {
        // The other program lets go while the dialog is up.
        if (fd !== null) closeSync(fd)
        fd = null
        return ask(spec)
      }
      try {
        expect(await openDatabaseWithRecoveryFlow(d)).toBe('repos')
      } finally {
        if (fd !== null) closeSync(fd)
      }
      expect(d.asked.map((s) => ids(s))).toEqual([['retry', 'reveal', 'quit']])
      expect(d.asked[0]?.message).toMatch(/another program is using the file/)
    },
  )

  it('damaged: a failed move-aside returns to the dialog saying so (no raw error, no exit)', async () => {
    const src = openDatabase({ path: join(dir, 'src.db') })
    src.tasks.create({ title: 'from backup' })
    takeBackup(src.db, join(dir, 'backups'), { now: new Date(2026, 0, 1).getTime() })
    src.db.close()
    const dataDir = join(dir, 'data')
    const dbFile = join(dataDir, 'todos.db')
    writeFileSync(dbFile, 'garbage')
    const d = deps(() => {
      const r = openDatabase({ path: dbFile })
      r.db.close()
      return 'repos'
    }, ['restore', 'quit'])
    // The damaged file cannot be renamed (read-only folder / held open on Windows).
    const unblock = blockRename(dataDir, dbFile)
    try {
      expect(await openDatabaseWithRecoveryFlow(d)).toBeNull()
    } finally {
      unblock()
    }
    expect(d.restoreFailed).not.toHaveBeenCalled()
    expect(d.asked).toHaveLength(2)
    expect(ids(d.asked[1] as StartupDialogSpec)).toContain('restore')
    expect(d.asked[1]?.detail).toMatch(/couldn't be moved aside/)
    expect(readdirSync(dataDir)).toEqual(['todos.db'])
  })
})
