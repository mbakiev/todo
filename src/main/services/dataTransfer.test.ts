import { EXPORT_APP_ID } from '@shared/constants'
import type { ExportFile, Tag, Task } from '@shared/types'
import { openDatabase, type Repos } from '../db'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listBackups } from './backup'
import {
  applyImport,
  buildExport,
  importBroadcast,
  parseExportFile,
  runImport,
} from './dataTransfer'

let clock = 1_000_000
const now = () => clock
let r: Repos

beforeEach(() => {
  clock = 1_000_000
  r = openDatabase({ path: ':memory:', now })
})
afterEach(() => r.db.close())

function task(over: Partial<Task> & { id: string }): Task {
  return {
    title: over.id,
    description: '',
    status: 'not_started',
    priority: 2,
    startDate: null,
    dueDate: null,
    position: 0,
    tagIds: [],
    createdAt: 100,
    updatedAt: 100,
    completedAt: null,
    ...over,
  }
}
const tag = (over: Partial<Tag> & { id: string; name: string }): Tag => ({
  color: 'blue',
  createdAt: 50,
  ...over,
})
const file = (tasks: Task[], tags: Tag[] = []): ExportFile => ({
  app: EXPORT_APP_ID,
  formatVersion: 1,
  exportedAt: 1,
  tasks,
  tags,
})

describe('parseExportFile', () => {
  it('accepts a file saved with a UTF-8 byte-order mark', () => {
    const text = JSON.stringify(file([task({ id: 'bom' })]))
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')])
    expect(parseExportFile(bytes.toString('utf8')).tasks.map((t) => t.id)).toEqual(['bom'])
  })

  it('round-trips buildExport', () => {
    r.tasks.create({ title: 'a', newTagNames: ['x'], dueDate: '2026-11-20' })
    const exported = buildExport(r, 42)
    expect(parseExportFile(JSON.stringify(exported))).toEqual(exported)
  })
  it('rejects non-JSON, foreign files and damaged files', () => {
    expect(() => parseExportFile('nope')).toThrow(/not valid JSON/)
    expect(() => parseExportFile('\uFEFF\uFEFF{}')).toThrow(/not valid JSON/)
    expect(() => parseExportFile('{"app":"other"}')).toThrow(/not a Martin's To Dos export/)
    expect(() => parseExportFile(JSON.stringify({ ...file([]), tasks: [{ id: 1 }] }))).toThrow(
      /damaged or incomplete at tasks\.0/,
    )
  })
  it('rejects files from a newer format version with a clear message', () => {
    expect(() => parseExportFile(JSON.stringify({ ...file([]), formatVersion: 2 }))).toThrow(
      /newer version.*format 2/,
    )
  })
  it('rejects duplicate ids', () => {
    expect(() =>
      parseExportFile(JSON.stringify(file([task({ id: 'a' }), task({ id: 'a' })]))),
    ).toThrow(/more than once/)
  })
})

describe('applyImport — merge', () => {
  it('adds new tasks and tags, keeping ids and timestamps', () => {
    const res = applyImport(
      r,
      file(
        [task({ id: 't1', tagIds: ['g1'], createdAt: 7, updatedAt: 9 })],
        [tag({ id: 'g1', name: 'Work' })],
      ),
      'merge',
    )
    expect(res).toMatchObject({ tasksAdded: 1, tasksUpdated: 0, tasksSkipped: 0, tagsAdded: 1 })
    expect(r.tasks.get('t1')).toMatchObject({ tagIds: ['g1'], createdAt: 7, updatedAt: 9 })
    expect(r.tags.get('g1')?.name).toBe('Work')
  })

  it('newer updatedAt wins; older or equal is skipped', () => {
    const local = r.tasks.create({ title: 'local' }).task // updatedAt = 1_000_000
    const res = applyImport(
      r,
      file([task({ id: local.id, title: 'older', updatedAt: local.updatedAt - 1 })]),
      'merge',
    )
    expect(res).toMatchObject({ tasksSkipped: 1, tasksUpdated: 0 })
    expect(r.tasks.get(local.id)?.title).toBe('local')

    const res2 = applyImport(
      r,
      file([
        task({
          id: local.id,
          title: 'newer',
          status: 'done',
          completedAt: 5,
          updatedAt: local.updatedAt + 1,
        }),
      ]),
      'merge',
    )
    expect(res2).toMatchObject({ tasksUpdated: 1 })
    expect(r.tasks.get(local.id)).toMatchObject({ title: 'newer', status: 'done', completedAt: 5 })
  })

  it('revives a locally soft-deleted task only when the file copy is newer', () => {
    const t = r.tasks.create({ title: 'gone' }).task
    clock += 10
    r.tasks.softDelete(t.id)
    applyImport(r, file([task({ id: t.id, updatedAt: t.updatedAt + 5 })]), 'merge')
    expect(r.tasks.get(t.id)).toBeUndefined()
    applyImport(r, file([task({ id: t.id, title: 'back', updatedAt: clock + 1 })]), 'merge')
    expect(r.tasks.get(t.id)?.title).toBe('back')
  })

  it('matches tags by id, then case-insensitively by name', () => {
    const work = r.tags.create({ name: 'Work', color: 'red' })
    const home = r.tags.create({ name: 'home', color: 'green' })
    const res = applyImport(
      r,
      file(
        [task({ id: 't1', tagIds: ['other-id-for-home', work.id] })],
        [
          tag({ id: work.id, name: 'Work', color: 'violet' }), // by id → recoloured
          tag({ id: 'other-id-for-home', name: 'HOME' }), // by name → mapped
        ],
      ),
      'merge',
    )
    expect(res).toMatchObject({ tagsAdded: 0, tagsUpdated: 1 })
    expect(r.tags.list()).toHaveLength(2)
    expect(r.tags.get(work.id)?.color).toBe('violet')
    expect(r.tasks.get('t1')?.tagIds.sort()).toEqual([home.id, work.id].sort())
  })

  it('keeps the local name when a renamed tag would clash with another tag', () => {
    const a = r.tags.create({ name: 'a' })
    r.tags.create({ name: 'b' })
    applyImport(r, file([], [tag({ id: a.id, name: 'B', color: a.color })]), 'merge')
    expect(r.tags.get(a.id)?.name).toBe('a')
  })

  it('tag matching is order-independent: a renamed tag plus a new tag reusing its old name', () => {
    const a = r.tags.create({ name: 'A' })
    r.tasks.create({ title: 'local' })
    // The file's machine renamed A → B (same id) and then created a brand-new tag "A".
    for (const tags of [
      [tag({ id: 'new-a', name: 'A' }), tag({ id: a.id, name: 'B', color: a.color })],
      [tag({ id: a.id, name: 'B', color: a.color }), tag({ id: 'new-a', name: 'A' })],
    ]) {
      applyImport(
        r,
        file(
          [
            task({ id: 'tagged-new-a', tagIds: ['new-a'], updatedAt: Date.now() + 1e6 }),
            task({ id: 'tagged-b', tagIds: [a.id], updatedAt: Date.now() + 1e6 }),
          ],
          tags,
        ),
        'merge',
      )
      const names = (id: string): string[] =>
        (r.tasks.get(id)?.tagIds ?? []).map((t) => r.tags.get(t)?.name ?? '?')
      expect(names('tagged-new-a')).toEqual(['A'])
      expect(names('tagged-b')).toEqual(['B'])
      expect(r.tags.get(a.id)?.name).toBe('B')
      expect(
        r.tags
          .list()
          .map((t) => t.name)
          .sort(),
      ).toEqual(['A', 'B'])
    }
  })

  it('swapped tag names (A↔B by id) merge without a UNIQUE conflict', () => {
    const a = r.tags.create({ name: 'A' })
    const b = r.tags.create({ name: 'B' })
    applyImport(
      r,
      file(
        [],
        [
          tag({ id: a.id, name: 'B', color: a.color }),
          tag({ id: b.id, name: 'A', color: b.color }),
        ],
      ),
      'merge',
    )
    expect(r.tags.get(a.id)?.name).toBe('B')
    expect(r.tags.get(b.id)?.name).toBe('A')
  })

  it('drops references to tags that exist nowhere', () => {
    applyImport(r, file([task({ id: 't1', tagIds: ['ghost'] })]), 'merge')
    expect(r.tasks.get('t1')?.tagIds).toEqual([])
  })

  it('is atomic: a failing import changes nothing', () => {
    r.tasks.create({ title: 'keep' })
    const bad = file([task({ id: 'x1' }), task({ id: 'x2', status: 'bogus' as Task['status'] })])
    expect(() => applyImport(r, bad, 'merge')).toThrow()
    expect(r.tasks.list().map((t) => t.title)).toEqual(['keep'])
  })
})

describe('applyImport — replace', () => {
  it('replaces everything, including soft-deleted rows and tags', () => {
    const old = r.tasks.create({ title: 'old', newTagNames: ['legacy'] }).task
    const deleted = r.tasks.create({ title: 'deleted' }).task
    r.tasks.softDelete(deleted.id)
    const before = { taskIds: [old.id], tagIds: r.tags.list().map((t) => t.id) }

    const res = applyImport(
      r,
      file(
        [task({ id: 'n1', tagIds: ['g'] }), task({ id: 'n2' })],
        [tag({ id: 'g', name: 'fresh' })],
      ),
      'replace',
    )
    expect(res).toEqual({
      mode: 'replace',
      tasksAdded: 2,
      tasksUpdated: 0,
      tasksSkipped: 0,
      tagsAdded: 1,
      tagsUpdated: 0,
    })
    expect(
      r.tasks
        .list()
        .map((t) => t.id)
        .sort(),
    ).toEqual(['n1', 'n2'])
    expect(r.tags.list().map((t) => t.name)).toEqual(['fresh'])
    expect(r.db.get('SELECT COUNT(*) AS n FROM tasks')).toEqual({ n: 2 })

    const change = importBroadcast(before, r)
    expect(change.removedTaskIds).toEqual([old.id])
    expect(change.removedTagIds).toHaveLength(1)
    expect(change.upsertedTasks).toHaveLength(2)
  })

  it('round-trips an export exactly', () => {
    const t = r.tasks.create({
      title: 'a',
      newTagNames: ['x'],
      priority: 4,
      startDate: '2026-11-01',
      dueDate: '2026-11-05',
    }).task
    clock += 5
    r.tasks.update(t.id, { status: 'done' })
    const exported = buildExport(r)
    r.db.exec('DELETE FROM task_tags; DELETE FROM tasks; DELETE FROM tags;')
    applyImport(r, parseExportFile(JSON.stringify(exported)), 'replace')
    expect(buildExport(r, exported.exportedAt)).toEqual(exported)
  })
})

describe('runImport safety copy', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mt-import-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  for (const mode of ['merge', 'replace'] as const) {
    it(`${mode}: takes a pre-import backup of the current data first`, () => {
      r.tasks.create({ title: 'local work' })
      const { result, broadcast } = runImport(r, dir, file([task({ id: 'f1' })]), mode)
      const backups = listBackups(dir)
      expect(backups.map((b) => b.kind)).toEqual(['preimport'])
      expect(result.backupPath).toBe(backups[0]?.path)
      expect(broadcast.authoritative).toBe(true)
      // The copy holds the data as it was before the import.
      const snap = openDatabase({ path: backups[0]?.path ?? '' })
      expect(snap.tasks.list().map((t) => t.title)).toEqual(['local work'])
      snap.db.close()
    })
  }

  it('skips the copy when the local database has no tasks', () => {
    const { result } = runImport(r, dir, file([task({ id: 'f1' })]), 'merge')
    expect(result.backupPath).toBeUndefined()
    expect(listBackups(dir)).toHaveLength(0)
    expect(r.tasks.get('f1')).toBeDefined()
  })
})
