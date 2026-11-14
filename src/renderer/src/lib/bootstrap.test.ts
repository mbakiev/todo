import { vi } from 'vitest'
import { defaultSettings } from '@shared/constants'
import type { DataChange, Settings, Tag, Task } from '@shared/types'
import { makeTask } from '@shared/test/factories'
import { EMPTY_FILTER } from '@shared/views'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTagsStore } from '@/stores/tagsStore'
import { useTasksStore } from '@/stores/tasksStore'
import { useUiStore } from '@/stores/uiStore'
import { installMockApi } from '@/test/mockApi'
import { bootstrap } from './bootstrap'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

type Listeners = {
  dataChanged?: (c: DataChange) => void
  settingsChanged?: (s: Settings) => void
  openTask?: (id: string) => void
}

function setup() {
  const listeners: Listeners = {}
  const tasks = deferred<Task[]>()
  const tags = deferred<Tag[]>()
  const settings = deferred<Settings>()
  installMockApi({
    tasks: { list: vi.fn(() => tasks.promise) },
    tags: { list: vi.fn(() => tags.promise) },
    settings: { get: vi.fn(() => settings.promise) },
    app: {
      getInfo: vi.fn(() =>
        Promise.resolve({ version: '1', platform: 'darwin' as const, isDev: false }),
      ),
    },
    on: {
      dataChanged: vi.fn((cb) => ((listeners.dataChanged = cb), () => {})),
      settingsChanged: vi.fn((cb) => ((listeners.settingsChanged = cb), () => {})),
      openTask: vi.fn((cb) => ((listeners.openTask = cb), () => {})),
    },
  })
  return { listeners, tasks, tags, settings }
}

beforeEach(() => {
  useTasksStore.setState({ byId: {}, loaded: false, pending: {}, sync: {} })
  useTagsStore.setState({ byId: {}, loaded: false, sync: {} })
  useSettingsStore.setState({
    settings: defaultSettings('darwin'),
    confirmed: defaultSettings('darwin'),
    ops: [],
    loaded: false,
  })
  useUiStore.setState({ selectedTaskId: null, filter: EMPTY_FILTER })
})

describe('bootstrap', () => {
  it('buffers broadcasts that arrive during the initial load and applies them in order', async () => {
    const { listeners, tasks, tags, settings } = setup()
    const a = makeTask({ id: 'a', title: 'loaded', updatedAt: 10 })
    const done = bootstrap({ persistView: true })

    // Subscribed before anything resolved.
    expect(listeners.dataChanged).toBeDefined()
    listeners.dataChanged?.({ upsertedTasks: [{ ...a, title: 'edited elsewhere', updatedAt: 11 }] })
    listeners.dataChanged?.({ upsertedTasks: [makeTask({ id: 'b', title: 'created elsewhere' })] })
    listeners.settingsChanged?.({ ...defaultSettings('darwin'), weekStartsOn: 0 })
    listeners.openTask?.('b')

    tasks.resolve([a])
    tags.resolve([])
    settings.resolve(defaultSettings('darwin'))
    await done

    const byId = useTasksStore.getState().byId
    expect(byId.a?.title).toBe('edited elsewhere')
    expect(byId.b?.title).toBe('created elsewhere')
    expect(useSettingsStore.getState().settings.weekStartsOn).toBe(0)
    expect(useUiStore.getState().selectedTaskId).toBe('b')
  })

  it('a deleted tag leaves the active filter (local delete, broadcast or import)', async () => {
    const { listeners, tasks, tags, settings } = setup()
    const tag = (id: string): Tag => ({ id, name: id, color: 'blue', createdAt: 1 })
    const done = bootstrap()
    tasks.resolve([])
    tags.resolve([tag('x'), tag('y'), tag('z')])
    settings.resolve(defaultSettings('darwin'))
    await done

    useUiStore.getState().setFilterTags(['x', 'y', 'z'])
    listeners.dataChanged?.({ removedTagIds: ['x'] })
    expect(useUiStore.getState().filter.tagIds).toEqual(['y', 'z'])

    installMockApi({ tags: { delete: vi.fn(() => Promise.resolve()) } })
    await useTagsStore.getState().remove('y')
    expect(useUiStore.getState().filter.tagIds).toEqual(['z'])
  })
})
