// Global shortcuts (spec §9): toggle main window, quick add. Registration failures are
// surfaced through ShortcutStatus (Settings shows them), never silent.
//
// The registration logic (`createShortcutManager`) is independent of Electron so it can be
// unit-tested with a fake registrar. In test runs (isTestRun) a fake registrar is used so
// e2e tests never grab real OS-wide hotkeys; tests trigger shortcuts through the
// `__martinTodosTest` hook instead.
import { globalShortcut } from 'electron'
import { normalizeAccelerator } from '@shared/accelerators'
import type { Settings, ShortcutStatus } from '@shared/types'
import type { AppContext } from './context'
import { isTestRun } from './paths'
import {
  createShortcutManager,
  type ShortcutManager,
  type ShortcutName,
  type ShortcutRegistrar,
} from './shortcutManager'
import { toggleMainWindow } from './windows/mainWindow'
import { toggleQuickAdd } from './windows/quickAddWindow'

// --- app wiring ---------------------------------------------------------------

const electronRegistrar: ShortcutRegistrar = {
  register: (accel, cb) => globalShortcut.register(accel, cb),
  unregister: (accel) => globalShortcut.unregister(accel),
}

/** In-memory registrar for test runs. `MARTIN_TODOS_FAKE_TAKEN_SHORTCUTS` lists combos to refuse. */
function createFakeRegistrar(): ShortcutRegistrar & { trigger(accel: string): boolean } {
  const taken = new Set(
    (process.env['MARTIN_TODOS_FAKE_TAKEN_SHORTCUTS'] ?? '')
      .split(',')
      .map((s) => normalizeAccelerator(s, process.platform))
      .filter(Boolean),
  )
  const callbacks = new Map<string, () => void>()
  return {
    register(accel, cb) {
      const norm = normalizeAccelerator(accel, process.platform)
      if (norm === '') throw new Error(`invalid accelerator "${accel}"`)
      if (taken.has(norm)) return false
      callbacks.set(norm, cb)
      return true
    },
    unregister(accel) {
      callbacks.delete(normalizeAccelerator(accel, process.platform))
    },
    trigger(accel) {
      const cb = callbacks.get(normalizeAccelerator(accel, process.platform))
      cb?.()
      return !!cb
    },
  }
}

let manager: ShortcutManager | null = null

function getManager(ctx: AppContext): ShortcutManager {
  if (manager) return manager
  const actions: Record<ShortcutName, () => void> = {
    toggleApp: () => toggleMainWindow(ctx),
    quickAdd: () => toggleQuickAdd(ctx),
  }
  if (isTestRun) {
    const fake = createFakeRegistrar()
    manager = createShortcutManager(fake, actions, process.platform)
    installTestHook({
      triggerShortcut: (name: ShortcutName) => {
        const accel = manager?.status()[name].accelerator ?? ''
        return accel !== '' && fake.trigger(accel)
      },
    })
  } else {
    manager = createShortcutManager(electronRegistrar, actions, process.platform)
  }
  return manager
}

/** Test-only hooks reachable from Playwright's `electronApp.evaluate` (test runs only). */
export function installTestHook(hooks: Record<string, unknown>): void {
  if (!isTestRun) return
  const g = globalThis as unknown as { __martinTodosTest?: Record<string, unknown> }
  g.__martinTodosTest = { ...g.__martinTodosTest, ...hooks }
}

/** Called at startup and whenever `settings.shortcuts` changes. */
export function registerGlobalShortcuts(
  ctx: AppContext,
  shortcuts: Settings['shortcuts'],
): ShortcutStatus {
  return getManager(ctx).apply(shortcuts)
}

export function getShortcutStatus(): ShortcutStatus {
  return (
    manager?.status() ?? {
      toggleApp: { accelerator: '', registered: false },
      quickAdd: { accelerator: '', registered: false },
    }
  )
}

/** While the Settings recorder is listening, real shortcuts must not fire. */
export function setGlobalShortcutsSuspended(ctx: AppContext, suspended: boolean): void {
  const m = getManager(ctx)
  if (suspended) m.suspend()
  else ctx.broadcastShortcutStatus(m.resume())
}

/** Called on will-quit. */
export function unregisterGlobalShortcuts(): void {
  manager?.unregisterAll()
  if (!isTestRun) globalShortcut.unregisterAll()
}
