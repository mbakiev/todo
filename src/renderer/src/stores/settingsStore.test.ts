import { vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/constants'
import type { Settings } from '@shared/types'
import { installMockApi } from '@/test/mockApi'
import { useSettingsStore } from './settingsStore'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() =>
  useSettingsStore.setState({
    settings: DEFAULT_SETTINGS,
    confirmed: DEFAULT_SETTINGS,
    ops: [],
    loaded: true,
  }),
)
const cur = (): Settings => useSettingsStore.getState().settings

describe('settingsStore optimistic updates', () => {
  it('a failed patch reverts only itself, keeping a concurrent successful one', async () => {
    const d1 = deferred<Settings>()
    const d2 = deferred<Settings>()
    const set = vi.fn().mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise)
    installMockApi({ settings: { set } })
    const p1 = useSettingsStore.getState().set({ theme: 'dark' })
    const p2 = useSettingsStore.getState().set({ lastView: 'list' })
    expect(cur()).toMatchObject({ theme: 'dark', lastView: 'list' })
    const saved = { ...DEFAULT_SETTINGS, lastView: 'list' as const }
    d2.resolve(saved)
    await p2
    expect(cur().theme).toBe('dark') // still pending
    d1.reject(new Error('disk full'))
    await p1
    expect(cur()).toEqual(saved)
  })

  it('an earlier answer or broadcast never flashes back a later pending patch', async () => {
    const d1 = deferred<Settings>()
    const d2 = deferred<Settings>()
    const set = vi.fn().mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise)
    installMockApi({ settings: { set } })
    const p1 = useSettingsStore.getState().set({ theme: 'dark' })
    const p2 = useSettingsStore.getState().set({ weekStartsOn: 0 })
    const after1 = { ...DEFAULT_SETTINGS, theme: 'dark' as const }
    useSettingsStore.getState().apply(after1)
    expect(cur().weekStartsOn).toBe(0)
    d1.resolve(after1)
    await p1
    expect(cur()).toMatchObject({ theme: 'dark', weekStartsOn: 0 })
    const after2 = { ...after1, weekStartsOn: 0 as const }
    d2.resolve(after2)
    await p2
    expect(cur()).toEqual(after2)
  })
})
