import { vi } from 'vitest'
import type { Tag } from '@shared/types'
import { installMockApi } from '@/test/mockApi'
import { useTagsStore } from './tagsStore'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

const work: Tag = { id: 'w', name: 'Work', color: 'blue', createdAt: 1 }

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => useTagsStore.setState({ byId: { w: work }, loaded: true, sync: {} }))
const w = (): Tag | undefined => useTagsStore.getState().byId.w

describe('tagsStore optimistic updates', () => {
  it('a failed rename keeps a recolour that succeeded meanwhile', async () => {
    const d1 = deferred<Tag>()
    const d2 = deferred<Tag>()
    const update = vi.fn().mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise)
    installMockApi({ tags: { update } })
    const p1 = useTagsStore.getState().update('w', { name: 'Job' })
    const p2 = useTagsStore.getState().update('w', { color: 'red' })
    expect(w()).toMatchObject({ name: 'Job', color: 'red' })
    d2.resolve({ ...work, color: 'red' })
    await p2
    expect(w()).toMatchObject({ name: 'Job', color: 'red' }) // rename still pending
    d1.reject(new Error('name taken'))
    await p1
    expect(w()).toEqual({ ...work, color: 'red' })
  })

  it('the result of an earlier edit does not flash back a later pending one', async () => {
    const d1 = deferred<Tag>()
    const d2 = deferred<Tag>()
    const update = vi.fn().mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise)
    installMockApi({ tags: { update } })
    const p1 = useTagsStore.getState().update('w', { name: 'Job' })
    const p2 = useTagsStore.getState().update('w', { color: 'red' })
    d1.resolve({ ...work, name: 'Job' })
    await p1
    expect(w()).toMatchObject({ name: 'Job', color: 'red' })
    useTagsStore.getState().applyChange({ tags: [{ ...work, name: 'Job' }] })
    expect(w()?.color).toBe('red')
    d2.resolve({ ...work, name: 'Job', color: 'red' })
    await p2
    expect(useTagsStore.getState().sync).toEqual({})
  })

  it('a failed update reverts to a broadcast that arrived meanwhile, not the stale snapshot', async () => {
    const d = deferred<Tag>()
    installMockApi({ tags: { update: vi.fn(() => d.promise) } })
    const p = useTagsStore.getState().update('w', { color: 'red' })
    useTagsStore.getState().applyChange({ tags: [{ ...work, name: 'Renamed elsewhere' }] })
    expect(w()).toMatchObject({ name: 'Renamed elsewhere', color: 'red' })
    d.reject(new Error('x'))
    await p
    expect(w()).toEqual({ ...work, name: 'Renamed elsewhere' })
  })
})
