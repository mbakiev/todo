import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, POSITION_EPSILON, SOFT_DELETE_RETENTION_MS } from '@shared/constants'
import { openDb } from './connection'
import { openDatabase, type Repos } from './index'
import { migrate } from './migrate'

let clock = 1_000_000
const now = () => clock
let r: Repos

beforeEach(() => {
  clock = 1_000_000
  r = openDatabase({ path: ':memory:', now })
})
afterEach(() => r.db.close())

describe('migrations', () => {
  it('sets user_version and is idempotent', () => {
    expect(r.db.pragma<number>('user_version')).toBe(1)
    expect(migrate(r.db)).toBe(1)
  })
  it('rolls back a failing migration', () => {
    const db = openDb({ path: ':memory:' })
    expect(() =>
      migrate(db, [
        { version: 1, name: 'ok', sql: 'CREATE TABLE a (x)' },
        { version: 2, name: 'bad', sql: 'CREATE TABLE b (x); SELECT * FROM nope' },
      ]),
    ).toThrow()
    expect(db.pragma<number>('user_version')).toBe(1)
    expect(db.get("SELECT name FROM sqlite_master WHERE name = 'b'")).toBeUndefined()
    db.close()
  })
  it('refuses a newer schema', () => {
    r.db.exec('PRAGMA user_version = 99')
    expect(() => migrate(r.db)).toThrow(/newer/)
  })
})

describe('file database', () => {
  it('uses WAL and can take a consistent backup', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mt-test-'))
    try {
      const file = openDatabase({ path: join(dir, 'data', 'todos.db') })
      expect(file.db.pragma<string>('journal_mode')).toBe('wal')
      file.tasks.create({ title: 'persist me' })
      const backup = join(dir, 'backups', 'b.db')
      file.db.backupTo(backup)
      file.db.close()
      expect(existsSync(backup)).toBe(true)
      const restored = openDatabase({ path: backup })
      expect(restored.tasks.list().map((t) => t.title)).toEqual(['persist me'])
      restored.db.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('tasksRepo.create', () => {
  it('applies defaults', () => {
    const { task } = r.tasks.create({ title: '  Write spec  ' })
    expect(task).toMatchObject({
      title: 'Write spec',
      description: '',
      status: 'not_started',
      priority: 2,
      startDate: null,
      dueDate: null,
      tagIds: [],
      createdAt: clock,
      updatedAt: clock,
      completedAt: null,
    })
  })
  it('places new tasks at the top of their column', () => {
    const a = r.tasks.create({ title: 'a' }).task
    const b = r.tasks.create({ title: 'b' }).task
    const c = r.tasks.create({ title: 'c', status: 'blocked' }).task
    expect(a.position).toBe(0)
    expect(b.position).toBe(-1)
    expect(c.position).toBe(0)
  })
  it('sets completedAt when created done', () => {
    expect(r.tasks.create({ title: 'x', status: 'done' }).task.completedAt).toBe(clock)
  })
  it('validates dates', () => {
    expect(() =>
      r.tasks.create({ title: 'x', startDate: '2026-11-20', dueDate: '2026-11-19' }),
    ).toThrow(/Start date/)
    expect(() => r.tasks.create({ title: 'x', dueDate: '2026-13-01' })).toThrow(/Invalid due date/)
    expect(() => r.tasks.create({ title: '  ' })).toThrow(/Title/)
  })
  it('creates new tags and matches existing ones case-insensitively', () => {
    const ops = r.tags.create({ name: 'Ops' })
    const { task, createdTags } = r.tasks.create({
      title: 'x',
      newTagNames: ['ops', 'Home'],
      tagIds: [ops.id],
    })
    expect(createdTags.map((t) => t.name)).toEqual(['Home'])
    expect(task.tagIds).toHaveLength(2)
    expect(r.tags.list().map((t) => t.name)).toEqual(['Home', 'Ops'])
  })
  it('rejects unknown tag ids atomically', () => {
    expect(() => r.tasks.create({ title: 'x', tagIds: ['nope'] })).toThrow(/Unknown tag/)
    expect(r.tasks.list()).toHaveLength(0)
  })
})

describe('tasksRepo.update', () => {
  it('bumps updatedAt and maintains completedAt', () => {
    const { task } = r.tasks.create({ title: 'x' })
    clock += 10
    const done = r.tasks.update(task.id, { status: 'done' })
    expect(done.completedAt).toBe(clock)
    expect(done.updatedAt).toBe(clock)
    clock += 10
    const renamed = r.tasks.update(task.id, { title: 'y' })
    expect(renamed.completedAt).toBe(done.completedAt) // unchanged while staying done
    expect(renamed.updatedAt).toBe(clock)
    clock += 10
    const reopened = r.tasks.update(task.id, { status: 'in_progress' })
    expect(reopened.completedAt).toBeNull()
  })
  it('moves to the top of the new column on status change', () => {
    const a = r.tasks.create({ title: 'a', status: 'blocked' }).task
    const b = r.tasks.create({ title: 'b' }).task
    const moved = r.tasks.update(b.id, { status: 'blocked' })
    expect(moved.position).toBeLessThan(a.position)
  })
  it('validates date order against stored values', () => {
    const { task } = r.tasks.create({ title: 'x', dueDate: '2026-11-10' })
    expect(() => r.tasks.update(task.id, { startDate: '2026-11-11' })).toThrow(/Start date/)
    expect(r.tasks.update(task.id, { startDate: '2026-11-11', dueDate: null }).startDate).toBe(
      '2026-11-11',
    )
  })
  it('replaces tags', () => {
    const t1 = r.tags.create({ name: 'a' })
    const t2 = r.tags.create({ name: 'b' })
    const { task } = r.tasks.create({ title: 'x', tagIds: [t1.id] })
    expect(r.tasks.update(task.id, { tagIds: [t2.id, t2.id] }).tagIds).toEqual([t2.id])
  })
  it('throws for missing or deleted tasks', () => {
    expect(() => r.tasks.update('nope', { title: 'x' })).toThrow(/not found/)
    const { task } = r.tasks.create({ title: 'x' })
    r.tasks.softDelete(task.id)
    expect(() => r.tasks.update(task.id, { title: 'y' })).toThrow(/not found/)
  })
})

describe('tasksRepo.move', () => {
  function column(n: number) {
    // Created in reverse so display order is t0, t1, … (new tasks go on top).
    const ids: string[] = []
    for (let i = n - 1; i >= 0; i--) ids.unshift(r.tasks.create({ title: `t${i}` }).task.id)
    return ids
  }
  const order = () =>
    r.tasks
      .list()
      .filter((t) => t.status === 'not_started')
      .sort((a, b) => a.position - b.position)
      .map((t) => t.title)

  it('places at the midpoint of neighbours', () => {
    const [a, b, c] = column(3) as [string, string, string]
    const pa = r.tasks.get(a)?.position ?? NaN
    const pb = r.tasks.get(b)?.position ?? NaN
    const { task } = r.tasks.move(c, { beforeId: a, afterId: b })
    expect(order()).toEqual(['t0', 't2', 't1'])
    expect(task.position).toBe((pa + pb) / 2)
  })
  it('moves to top / bottom', () => {
    const [a, b, c] = column(3) as [string, string, string]
    r.tasks.move(c, { beforeId: null, afterId: a })
    expect(order()).toEqual(['t2', 't0', 't1'])
    r.tasks.move(c, { beforeId: b, afterId: null })
    expect(order()).toEqual(['t0', 't1', 't2'])
  })
  it('renumbers the column when the gap is too small', () => {
    const [a, b, c] = column(3) as [string, string, string]
    r.db.run('UPDATE tasks SET position = ? WHERE id = ?', [1, a])
    r.db.run('UPDATE tasks SET position = ? WHERE id = ?', [1 + POSITION_EPSILON / 10, b])
    r.db.run('UPDATE tasks SET position = ? WHERE id = ?', [5, c])
    const { task, renumbered } = r.tasks.move(c, { beforeId: a, afterId: b })
    expect(renumbered.map((t) => t.id).sort()).toEqual([a, b].sort())
    expect(r.tasks.get(a)?.position).toBe(0)
    expect(r.tasks.get(b)?.position).toBe(1)
    expect(task.position).toBe(0.5)
    expect(order()).toEqual(['t0', 't2', 't1'])
  })
  it('survives many bisections', () => {
    const [a, b, c, d] = column(4) as [string, string, string, string]
    let toggle = false
    for (let i = 0; i < 100; i++) {
      // Alternate inserting c and d between a and whatever follows a.
      const moving = toggle ? c : d
      const afterA = r.tasks
        .list()
        .filter((t) => t.id !== moving)
        .sort((x, y) => x.position - y.position)
      const idx = afterA.findIndex((t) => t.id === a)
      r.tasks.move(moving, { beforeId: a, afterId: afterA[idx + 1]?.id ?? null })
      toggle = !toggle
    }
    expect(order()[0]).toBe('t0')
    expect(new Set(r.tasks.list().map((t) => t.position)).size).toBe(4)
    expect(r.tasks.get(b)).toBeDefined()
  })
  it('changes status and maintains completedAt', () => {
    const [a] = column(1) as [string]
    const d = r.tasks.create({ title: 'done1', status: 'done' }).task
    clock += 5
    const { task } = r.tasks.move(a, { status: 'done', beforeId: null, afterId: d.id })
    expect(task.status).toBe('done')
    expect(task.completedAt).toBe(clock)
    expect(task.position).toBeLessThan(d.position)
    expect(
      r.tasks.move(a, { status: 'blocked', beforeId: null, afterId: null }).task.completedAt,
    ).toBeNull()
  })
  it('rejects neighbours from another column or itself', () => {
    const [a] = column(1) as [string]
    const x = r.tasks.create({ title: 'x', status: 'blocked' }).task
    expect(() => r.tasks.move(a, { beforeId: x.id, afterId: null })).toThrow(/not in column/)
    expect(() => r.tasks.move(a, { beforeId: a, afterId: null })).toThrow(/own neighbour/)
  })
})

describe('soft delete', () => {
  it('hides, restores and purges after 30 days', () => {
    const { task } = r.tasks.create({ title: 'x' })
    clock += 1
    r.tasks.softDelete(task.id)
    expect(r.tasks.list()).toHaveLength(0)
    expect(r.tasks.get(task.id)).toBeUndefined()
    expect(() => r.tasks.softDelete(task.id)).toThrow(/not found/)
    clock += 1
    const restored = r.tasks.restore(task.id)
    expect(restored.updatedAt).toBe(clock)
    expect(r.tasks.list()).toHaveLength(1)
    // Restore of a live task is a no-op.
    expect(r.tasks.restore(task.id).id).toBe(task.id)

    r.tasks.softDelete(task.id)
    clock += SOFT_DELETE_RETENTION_MS - 10
    expect(r.tasks.purgeDeleted()).toBe(0)
    clock += 20
    expect(r.tasks.purgeDeleted()).toBe(1)
    expect(() => r.tasks.restore(task.id)).toThrow(/not found/)
  })
  it('purge cascades task_tags', () => {
    const tag = r.tags.create({ name: 'a' })
    const { task } = r.tasks.create({ title: 'x', tagIds: [tag.id] })
    r.tasks.softDelete(task.id)
    clock += SOFT_DELETE_RETENTION_MS + 1
    r.tasks.purgeDeleted()
    expect(r.db.all('SELECT * FROM task_tags')).toHaveLength(0)
  })
})

describe('tagsRepo', () => {
  it('enforces unique names case-insensitively', () => {
    r.tags.create({ name: 'Work' })
    expect(() => r.tags.create({ name: 'work' })).toThrow(/already exists/)
    const home = r.tags.create({ name: 'home' })
    expect(() => r.tags.update(home.id, { name: 'WORK' })).toThrow(/already exists/)
    expect(r.tags.update(home.id, { name: 'Home' }).name).toBe('Home') // same tag, case change
  })
  it('auto-assigns the least-used palette colour', () => {
    const colours = Array.from({ length: 9 }, (_, i) => r.tags.create({ name: `t${i}` }).color)
    expect(new Set(colours.slice(0, 8)).size).toBe(8)
    expect(colours[8]).toBe(colours[0])
  })
  it('delete removes the tag from tasks and reports affected tasks', () => {
    const tag = r.tags.create({ name: 'a' })
    const { task } = r.tasks.create({ title: 'x', tagIds: [tag.id] })
    clock += 7
    expect(r.tags.delete(tag.id).affectedTaskIds).toEqual([task.id])
    const after = r.tasks.get(task.id)
    expect(after?.tagIds).toEqual([])
    expect(after?.updatedAt).toBe(clock)
  })
})

describe('settingsRepo', () => {
  it('returns defaults, merges nested objects, persists', () => {
    expect(r.settings.get()).toEqual(DEFAULT_SETTINGS)
    const s = r.settings.set({
      theme: 'dark',
      boardSort: { week: 'manual' },
      shortcuts: { quickAdd: 'Alt+Space' },
    })
    expect(s.theme).toBe('dark')
    expect(s.boardSort).toEqual({ today: 'priority', week: 'manual', everything: 'priority' })
    expect(s.shortcuts).toEqual({ toggleApp: 'Alt+Shift+T', quickAdd: 'Alt+Space' })
    expect(r.settings.get()).toEqual(s)
  })
  it('falls back to defaults for corrupt stored values', () => {
    r.db.run(
      "INSERT INTO settings (key, value) VALUES ('theme', '\"neon\"'), ('weekStartsOn', 'not json')",
    )
    expect(r.settings.get().theme).toBe('system')
    expect(r.settings.get().weekStartsOn).toBe(1)
  })
})
