import { vi } from 'vitest'
import type { Task } from '@shared/types'
import { installMockApi } from '@/test/mockApi'
import { useTasksStore } from './tasksStore'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

const base: Task = {
  id: 'a',
  title: 'A',
  description: '',
  status: 'not_started',
  priority: 2,
  startDate: null,
  dueDate: null,
  position: 0,
  tagIds: [],
  createdAt: 1,
  updatedAt: 1,
  completedAt: null,
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  useTasksStore.setState({ byId: { a: base }, loaded: true, pending: {}, sync: {} })
})

const a = (): Task | undefined => useTasksStore.getState().byId.a

/** All orderings of `items`. */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]]
  return items.flatMap((x, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [x, ...rest]),
  )
}

describe('tasksStore', () => {
  it('applies updates optimistically and reconciles with the server record', async () => {
    const d = deferred<Task>()
    installMockApi({ tasks: { update: vi.fn(() => d.promise) } })
    const p = useTasksStore.getState().update('a', { status: 'done' })
    const optimistic = useTasksStore.getState().byId.a
    expect(optimistic?.status).toBe('done')
    expect(optimistic?.completedAt).not.toBeNull()
    d.resolve({ ...base, status: 'done', completedAt: 99, updatedAt: Date.now() + 1000 })
    await p
    expect(useTasksStore.getState().byId.a?.completedAt).toBe(99)
    expect(useTasksStore.getState().pending).toEqual({})
  })

  it('rolls back on error', async () => {
    installMockApi({ tasks: { update: vi.fn(() => Promise.reject(new Error('nope'))) } })
    const result = await useTasksStore.getState().update('a', { title: 'B' })
    expect(result).toBeNull()
    expect(useTasksStore.getState().byId.a?.title).toBe('A')
  })

  it('create shows a temp task, then the real one exactly once (even if the broadcast arrives first)', async () => {
    const d = deferred<Task>()
    installMockApi({ tasks: { create: vi.fn(() => d.promise) } })
    const p = useTasksStore.getState().create({ title: 'New' })
    const ids = Object.keys(useTasksStore.getState().byId)
    expect(ids.some((id) => id.startsWith('tmp-'))).toBe(true)
    const real = { ...base, id: 'b', title: 'New', position: -1 }
    useTasksStore.getState().applyChange({ upsertedTasks: [real] })
    expect(
      Object.values(useTasksStore.getState().byId).filter((t) => t.title === 'New'),
    ).toHaveLength(1)
    d.resolve(real)
    await p
    expect(Object.keys(useTasksStore.getState().byId).sort()).toEqual(['a', 'b'])
  })

  it('applyChange is idempotent and removes ids', () => {
    const s = useTasksStore.getState()
    const t = { ...base, title: 'X', updatedAt: 5 }
    s.applyChange({ upsertedTasks: [t] })
    s.applyChange({ upsertedTasks: [t] })
    expect(useTasksStore.getState().byId.a?.title).toBe('X')
    s.applyChange({ removedTaskIds: ['a', 'zzz'] })
    expect(useTasksStore.getState().byId).toEqual({})
  })

  it('ignores stale broadcasts while a mutation is in flight', async () => {
    const d = deferred<Task>()
    installMockApi({ tasks: { update: vi.fn(() => d.promise) } })
    const p = useTasksStore.getState().update('a', { title: 'Newer' })
    useTasksStore
      .getState()
      .applyChange({ upsertedTasks: [{ ...base, title: 'Old', updatedAt: 2 }] })
    expect(useTasksStore.getState().byId.a?.title).toBe('Newer')
    d.resolve({ ...base, title: 'Newer', updatedAt: Date.now() + 5 })
    await p
  })

  it('drops a broadcast older than the local copy unless it is authoritative (import)', () => {
    useTasksStore.setState({ byId: { a: { ...base, title: 'Newer', updatedAt: 50 } } })
    useTasksStore
      .getState()
      .applyChange({ upsertedTasks: [{ ...base, title: 'Old', updatedAt: 40 }] })
    expect(a()?.title).toBe('Newer')
    useTasksStore.getState().applyChange({
      upsertedTasks: [{ ...base, title: 'Imported', updatedAt: 40 }],
      authoritative: true,
    })
    expect(a()?.title).toBe('Imported')
  })

  it('delete + restore round trip', async () => {
    installMockApi({
      tasks: {
        delete: vi.fn(() => Promise.resolve()),
        restore: vi.fn(() => Promise.resolve({ ...base, updatedAt: 9 })),
      },
    })
    expect(await useTasksStore.getState().remove('a')).toBe(true)
    expect(useTasksStore.getState().byId.a).toBeUndefined()
    await useTasksStore.getState().restore('a')
    expect(useTasksStore.getState().byId.a?.updatedAt).toBe(9)
  })

  describe('concurrent writes to one task', () => {
    // Main applies #1 (title) then #2 (description). Each produces a broadcast (b) and an
    // invoke result (r); here they arrive in every possible order.
    const s1: Task = { ...base, title: 'NEW TITLE', updatedAt: 10 }
    const s2: Task = { ...base, title: 'NEW TITLE', description: 'new desc', updatedAt: 11 }
    type Ev = 'b1' | 'r1' | 'b2' | 'r2'

    for (const order of permutations<Ev>(['b1', 'r1', 'b2', 'r2'])) {
      it(`never shows a reverted field and ends at the server state: ${order.join(' ')}`, async () => {
        const d1 = deferred<Task>()
        const d2 = deferred<Task>()
        const update = vi.fn().mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise)
        installMockApi({ tasks: { update } })
        const p1 = useTasksStore.getState().update('a', { title: 'NEW TITLE' })
        const p2 = useTasksStore.getState().update('a', { description: 'new desc' })
        const check = (): void => {
          expect(a()?.title).toBe('NEW TITLE')
          expect(a()?.description).toBe('new desc')
        }
        check()
        for (const ev of order) {
          if (ev === 'b1') useTasksStore.getState().applyChange({ upsertedTasks: [s1] })
          if (ev === 'b2') useTasksStore.getState().applyChange({ upsertedTasks: [s2] })
          if (ev === 'r1') {
            d1.resolve(s1)
            await p1
          }
          if (ev === 'r2') {
            d2.resolve(s2)
            await p2
          }
          check()
        }
        expect(a()).toEqual(s2)
        expect(useTasksStore.getState().pending).toEqual({})
        expect(useTasksStore.getState().sync).toEqual({})
      })
    }

    it('a failed update reverts only its own fields, to the newest server copy', async () => {
      const d1 = deferred<Task>()
      const d2 = deferred<Task>()
      const update = vi.fn().mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise)
      installMockApi({ tasks: { update } })
      const p1 = useTasksStore.getState().update('a', { priority: 4 })
      const p2 = useTasksStore.getState().update('a', { description: 'new desc' })
      const saved = { ...base, description: 'new desc', updatedAt: 5 }
      useTasksStore.getState().applyChange({ upsertedTasks: [saved] })
      d2.resolve(saved)
      await p2
      expect(a()?.priority).toBe(4) // still pending
      d1.reject(new Error('boom'))
      await p1
      expect(a()).toEqual(saved)
    })

    it('a failed update does not revert a field a later pending write also set', async () => {
      const d1 = deferred<Task>()
      const d2 = deferred<Task>()
      const update = vi.fn().mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise)
      installMockApi({ tasks: { update } })
      const p1 = useTasksStore.getState().update('a', { title: 'first' })
      const p2 = useTasksStore.getState().update('a', { title: 'second' })
      d1.reject(new Error('boom'))
      await p1
      expect(a()?.title).toBe('second')
      d2.resolve({ ...base, title: 'second', updatedAt: 3 })
      await p2
      expect(a()?.title).toBe('second')
    })

    it('a failed move keeps an update that succeeded meanwhile', async () => {
      const dm = deferred<Task>()
      installMockApi({
        tasks: {
          move: vi.fn(() => dm.promise),
          update: vi.fn(() => Promise.resolve({ ...base, title: 'renamed', updatedAt: 4 })),
        },
      })
      const pm = useTasksStore
        .getState()
        .move('a', { status: 'done', beforeId: null, afterId: null })
      expect(a()?.status).toBe('done')
      await useTasksStore.getState().update('a', { title: 'renamed' })
      expect(a()).toMatchObject({ title: 'renamed', status: 'done' })
      dm.reject(new Error('nope'))
      await pm
      expect(a()).toEqual({ ...base, title: 'renamed', updatedAt: 4 })
    })

    it('a failed delete brings back the newest server copy, not the pre-delete snapshot', async () => {
      const dd = deferred<void>()
      installMockApi({ tasks: { delete: vi.fn(() => dd.promise) } })
      const pd = useTasksStore.getState().remove('a')
      expect(a()).toBeUndefined()
      // Another window edited the task meanwhile.
      const edited = { ...base, title: 'edited elsewhere', updatedAt: 7 }
      useTasksStore.getState().applyChange({ upsertedTasks: [edited] })
      expect(a()).toBeUndefined() // still optimistically deleted
      dd.reject(new Error('locked'))
      expect(await pd).toBe(false)
      expect(a()).toEqual(edited)
    })

    it('undo while the delete is still in flight shows the task throughout', async () => {
      const dd = deferred<void>()
      const dr = deferred<Task>()
      installMockApi({
        tasks: { delete: vi.fn(() => dd.promise), restore: vi.fn(() => dr.promise) },
      })
      const pd = useTasksStore.getState().remove('a')
      const pr = useTasksStore.getState().restore('a')
      expect(a()?.title).toBe('A')
      useTasksStore.getState().applyChange({ removedTaskIds: ['a'] })
      dd.resolve()
      await pd
      expect(a()?.title).toBe('A')
      const restored = { ...base, updatedAt: 9 }
      dr.resolve(restored)
      await pr
      expect(a()).toEqual(restored)
    })

    it('a failed restore removes the optimistic copy again', async () => {
      installMockApi({
        tasks: {
          delete: vi.fn(() => Promise.resolve()),
          restore: vi.fn(() => Promise.reject(new Error('gone'))),
        },
      })
      await useTasksStore.getState().remove('a')
      expect(await useTasksStore.getState().restore('a')).toBeNull()
      expect(a()).toBeUndefined()
    })
  })
})
