import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import { openDatabase, type Repos } from '../db'
import {
  backupFileName,
  backupIfDue,
  getBackupInfo,
  listBackups,
  parseBackupName,
  parseBackupTime,
  rotateBackups,
  takeBackup,
} from './backup'

// rmSync passes through unless a test makes it throw for a path (Windows file locks).
const rm = vi.hoisted(() => ({ lockedPaths: new Set<string>() }))
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  return {
    ...real,
    rmSync: vi.fn((path: string, opts?: import('node:fs').RmOptions) => {
      if (rm.lockedPaths.has(path)) {
        throw Object.assign(new Error(`EBUSY: resource busy or locked, unlink '${path}'`), {
          code: 'EBUSY',
        })
      }
      real.rmSync(path, opts)
    }),
  }
})

let dir: string
let r: Repos

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mt-backup-'))
  r = openDatabase({ path: join(dir, 'data', 'todos.db') })
})
afterEach(() => {
  rm.lockedPaths.clear()
  r.db.close()
  rmSync(dir, { recursive: true, force: true })
})

const at = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) =>
  new Date(y, mo - 1, d, h, mi, s).getTime()

describe('backup file names', () => {
  it('formats local time and parses it back', () => {
    const t = at(2026, 3, 7, 9, 5, 2)
    expect(backupFileName(new Date(t))).toBe('todos-20260307-090502.db')
    expect(parseBackupTime('todos-20260307-090502.db')).toBe(t)
    expect(parseBackupTime('todos-20260307-090502-2.db')).toBe(t)
    expect(parseBackupTime('notes.db')).toBeNull()
  })
})

describe('rotation', () => {
  it('keeps the newest N of our files and ignores foreign files', () => {
    const backups = join(dir, 'backups')
    mkdirSync(backups)
    for (let day = 1; day <= 20; day++) {
      writeFileSync(join(backups, backupFileName(new Date(at(2026, 1, day, 12)))), '')
    }
    writeFileSync(join(backups, 'keep-me.txt'), '')
    const deleted = rotateBackups(backups, 'auto', 14)
    expect(deleted).toHaveLength(6)
    const left = listBackups(backups).map((f) => f.name)
    expect(left).toHaveLength(14)
    expect(left[0]).toBe('todos-20260120-120000.db')
    expect(left.at(-1)).toBe('todos-20260107-120000.db')
    expect(readdirSync(backups)).toContain('keep-me.txt')
  })
})

describe('takeBackup / backupIfDue', () => {
  it('writes a readable snapshot, disambiguates same-second backups and rotates', () => {
    r.tasks.create({ title: 'snap' })
    const backups = join(dir, 'backups')
    const t = at(2026, 5, 1, 8)
    const a = takeBackup(r.db, backups, { now: t, keep: 2 })
    const b = takeBackup(r.db, backups, { now: t, keep: 2 })
    expect(a.endsWith('todos-20260501-080000.db')).toBe(true)
    expect(b.endsWith('todos-20260501-080000-1.db')).toBe(true)
    takeBackup(r.db, backups, { now: t + 1000, keep: 2 })
    expect(listBackups(backups)).toHaveLength(2)

    const snap = openDatabase({ path: listBackups(backups)[0]?.path ?? '' })
    expect(snap.tasks.list().map((x) => x.title)).toEqual(['snap'])
    snap.db.close()
  })

  it('skips when a recent backup exists', () => {
    r.tasks.create({ title: 'something to back up' })
    const backups = join(dir, 'backups')
    const t = at(2026, 5, 1, 8)
    expect(backupIfDue(r, backups, 3_600_000, t)).not.toBeNull()
    expect(backupIfDue(r, backups, 3_600_000, t + 30 * 60_000)).toBeNull()
    expect(backupIfDue(r, backups, 3_600_000, t + 61 * 60_000)).not.toBeNull()
    const info = getBackupInfo(backups)
    expect(info.count).toBe(2)
    expect(info.latest?.createdAt).toBe(t + 61 * 60_000)
  })

  it('reports no backups for a missing folder', () => {
    expect(getBackupInfo(join(dir, 'nope'))).toEqual({
      dir: join(dir, 'nope'),
      latest: null,
      count: 0,
    })
  })
})

describe('retention by kind', () => {
  it('encodes the kind in the name; old unprefixed files are automatic', () => {
    const t = at(2026, 3, 7, 9, 5, 2)
    expect(backupFileName(new Date(t), 'manual')).toBe('todos-manual-20260307-090502.db')
    expect(backupFileName(new Date(t), 'preimport')).toBe('todos-preimport-20260307-090502.db')
    expect(parseBackupName('todos-20260307-090502.db')).toEqual({ kind: 'auto', createdAt: t })
    expect(parseBackupName('todos-manual-20260307-090502-1.db')).toEqual({
      kind: 'manual',
      createdAt: t,
    })
    expect(parseBackupName('todos-preimport-20260307-090502.db')?.kind).toBe('preimport')
    expect(parseBackupName('todos-other-20260307-090502.db')).toBeNull()
  })

  it('rotates each kind separately: 14 automatic, 10 manual, 5 pre-import', () => {
    r.tasks.create({ title: 'x' })
    const backups = join(dir, 'backups')
    for (let i = 0; i < 16; i++) takeBackup(r.db, backups, { now: at(2026, 1, 1 + i, 3) })
    for (let i = 0; i < 12; i++)
      takeBackup(r.db, backups, { kind: 'manual', now: at(2026, 2, 1 + i, 3) })
    for (let i = 0; i < 7; i++)
      takeBackup(r.db, backups, { kind: 'preimport', now: at(2026, 3, 1 + i, 3) })
    expect(listBackups(backups, 'auto')).toHaveLength(14)
    expect(listBackups(backups, 'manual')).toHaveLength(10)
    expect(listBackups(backups, 'preimport')).toHaveLength(5)
    // The oldest automatic backups went, not because of the newer manual / pre-import ones.
    expect(listBackups(backups, 'auto').at(-1)?.name).toBe('todos-20260103-030000.db')
    expect(listBackups(backups, 'manual').at(-1)?.name).toBe('todos-manual-20260203-030000.db')
    // "Last backup" info counts every kind.
    const info = getBackupInfo(backups)
    expect(info.count).toBe(29)
    expect(info.latest?.path.endsWith('todos-preimport-20260307-030000.db')).toBe(true)
  })

  it('many manual backups never rotate out the automatic history', () => {
    r.tasks.create({ title: 'x' })
    const backups = join(dir, 'backups')
    takeBackup(r.db, backups, { now: at(2026, 1, 1, 3) })
    for (let i = 0; i < 30; i++)
      takeBackup(r.db, backups, { kind: 'manual', now: at(2026, 1, 2, 3, 0, i) })
    expect(listBackups(backups, 'auto').map((f) => f.name)).toEqual(['todos-20260101-030000.db'])
  })

  it('never takes an automatic snapshot of a database with no tasks', () => {
    const backups = join(dir, 'backups')
    expect(backupIfDue(r, backups, 0, at(2026, 1, 1))).toBeNull()
    expect(listBackups(backups)).toHaveLength(0)
    const { task } = r.tasks.create({ title: 'one' })
    expect(backupIfDue(r, backups, 0, at(2026, 1, 2))).not.toBeNull()
    // Soft-deleted tasks still count: that history is worth keeping.
    r.tasks.softDelete(task.id)
    expect(backupIfDue(r, backups, 0, at(2026, 1, 3))).not.toBeNull()
    expect(listBackups(backups, 'auto')).toHaveLength(2)
  })

  it('a backup that cannot be deleted (EBUSY) is skipped; the new snapshot still succeeds', () => {
    r.tasks.create({ title: 'x' })
    const backups = join(dir, 'backups')
    const first = takeBackup(r.db, backups, { now: at(2026, 1, 1), keep: 2 })
    takeBackup(r.db, backups, { now: at(2026, 1, 2), keep: 2 })
    rm.lockedPaths.add(first)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const third = takeBackup(r.db, backups, { now: at(2026, 1, 3), keep: 2 })
    expect(listBackups(backups).map((f) => f.path)).toContain(third)
    expect(listBackups(backups).map((f) => f.path)).toContain(first) // still locked
    expect(warn).toHaveBeenCalled()
    // Once released, the next rotation removes it.
    rm.lockedPaths.clear()
    takeBackup(r.db, backups, { now: at(2026, 1, 4), keep: 2 })
    expect(listBackups(backups).map((f) => f.path)).not.toContain(first)
    expect(listBackups(backups)).toHaveLength(2)
    warn.mockRestore()
  })
})
