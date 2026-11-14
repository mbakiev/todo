import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, type Repos } from '../db'
import {
  backupFileName,
  backupIfDue,
  getBackupInfo,
  listBackups,
  parseBackupTime,
  rotateBackups,
  takeBackup,
} from './backup'

let dir: string
let r: Repos

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mt-backup-'))
  r = openDatabase({ path: join(dir, 'data', 'todos.db') })
})
afterEach(() => {
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
    const deleted = rotateBackups(backups, 14)
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
    const a = takeBackup(r.db, backups, t, 2)
    const b = takeBackup(r.db, backups, t, 2)
    expect(a.endsWith('todos-20260501-080000.db')).toBe(true)
    expect(b.endsWith('todos-20260501-080000-1.db')).toBe(true)
    takeBackup(r.db, backups, t + 1000, 2)
    expect(listBackups(backups)).toHaveLength(2)

    const snap = openDatabase({ path: listBackups(backups)[0]?.path ?? '' })
    expect(snap.tasks.list().map((x) => x.title)).toEqual(['snap'])
    snap.db.close()
  })

  it('skips when a recent backup exists', () => {
    const backups = join(dir, 'backups')
    const t = at(2026, 5, 1, 8)
    expect(backupIfDue(r.db, backups, 3_600_000, t)).not.toBeNull()
    expect(backupIfDue(r.db, backups, 3_600_000, t + 30 * 60_000)).toBeNull()
    expect(backupIfDue(r.db, backups, 3_600_000, t + 61 * 60_000)).not.toBeNull()
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
