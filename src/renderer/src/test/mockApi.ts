import { vi } from 'vitest'
import type { Api } from '@shared/ipc'

/** A window.api mock where every method is a vi.fn(); override per test. */
export function installMockApi(
  overrides: Partial<{ [K in keyof Api]: Partial<Api[K]> }> = {},
): Api {
  const unsub = (): (() => void) => () => {}
  const api: Api = {
    tasks: {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      move: vi.fn(),
      delete: vi.fn(),
      restore: vi.fn(),
      ...overrides.tasks,
    },
    tags: { list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), ...overrides.tags },
    settings: { get: vi.fn(), set: vi.fn(), ...overrides.settings },
    data: {
      exportToFile: vi.fn(),
      importFromFile: vi.fn(),
      backupNow: vi.fn(),
      revealDataFolder: vi.fn(),
      getBackupInfo: vi.fn(),
      ...overrides.data,
    },
    app: {
      getInfo: vi.fn(),
      showMainWindow: vi.fn(),
      hideQuickAdd: vi.fn(),
      resizeQuickAdd: vi.fn(),
      getShortcutStatus: vi.fn(),
      openSettings: vi.fn(),
      setGlobalShortcutsSuspended: vi.fn(),
      flushDone: vi.fn(),
      ...overrides.app,
    },
    on: {
      dataChanged: vi.fn(unsub),
      settingsChanged: vi.fn(unsub),
      openTask: vi.fn(unsub),
      quickAddShown: vi.fn(unsub),
      newTaskRequested: vi.fn(unsub),
      settingsRequested: vi.fn(unsub),
      shortcutStatusChanged: vi.fn(unsub),
      flushRequested: vi.fn(unsub),
      ...overrides.on,
    },
  }
  window.api = api
  return api
}
