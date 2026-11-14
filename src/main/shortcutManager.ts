// Pure global-shortcut registration logic (no Electron import) — unit-tested with a fake
// registrar in shortcutManager.test.ts. Wired to Electron's globalShortcut in shortcuts.ts.
import { normalizeAccelerator } from '@shared/accelerators'
import type { Platform, Settings, ShortcutStatus } from '@shared/types'

export type ShortcutName = keyof Settings['shortcuts']
const NAMES: readonly ShortcutName[] = ['toggleApp', 'quickAdd']
const LABELS: Record<ShortcutName, string> = {
  toggleApp: 'Show / hide window',
  quickAdd: 'Quick add',
}

export interface ShortcutRegistrar {
  /** Returns false when the OS refuses (combo owned by another app); throws if invalid. */
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

export interface ShortcutManager {
  /** (Re)registers both shortcuts; returns the resulting status. */
  apply(shortcuts: Settings['shortcuts']): ShortcutStatus
  /** Unregisters everything until `resume()` (used while recording a new combo). */
  suspend(): void
  resume(): ShortcutStatus
  unregisterAll(): void
  status(): ShortcutStatus
}

export function createShortcutManager(
  registrar: ShortcutRegistrar,
  actions: Record<ShortcutName, () => void>,
  platform: Platform,
): ShortcutManager {
  let registered: string[] = []
  let desired: Settings['shortcuts'] = { toggleApp: '', quickAdd: '' }
  let suspended = false
  let current: ShortcutStatus = {
    toggleApp: { accelerator: '', registered: false },
    quickAdd: { accelerator: '', registered: false },
  }

  const unregisterAll = (): void => {
    for (const accel of registered) {
      try {
        registrar.unregister(accel)
      } catch {
        // Already gone; nothing to do.
      }
    }
    registered = []
  }

  const register = (): ShortcutStatus => {
    unregisterAll()
    const claimed = new Map<string, ShortcutName>()
    const next = {} as ShortcutStatus
    for (const name of NAMES) {
      const accelerator = desired[name].trim()
      if (accelerator === '') {
        next[name] = { accelerator: '', registered: false }
        continue
      }
      const norm = normalizeAccelerator(accelerator, platform)
      if (norm === '') {
        next[name] = { accelerator, registered: false, error: 'Not a valid shortcut' }
        continue
      }
      const owner = claimed.get(norm)
      if (owner) {
        next[name] = {
          accelerator,
          registered: false,
          error: `Same shortcut as “${LABELS[owner]}”`,
        }
        continue
      }
      try {
        if (registrar.register(accelerator, actions[name])) {
          registered.push(accelerator)
          claimed.set(norm, name)
          next[name] = { accelerator, registered: true }
        } else {
          next[name] = {
            accelerator,
            registered: false,
            error: 'Already in use by another app or by the system',
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        next[name] = { accelerator, registered: false, error: `Could not register: ${msg}` }
      }
    }
    current = next
    return current
  }

  return {
    apply(shortcuts) {
      desired = { ...shortcuts }
      if (suspended) {
        // Report what will be attempted on resume; nothing is registered meanwhile.
        current = {
          toggleApp: { accelerator: desired.toggleApp, registered: false },
          quickAdd: { accelerator: desired.quickAdd, registered: false },
        }
        return current
      }
      return register()
    },
    suspend() {
      suspended = true
      unregisterAll()
    },
    resume() {
      suspended = false
      return register()
    },
    unregisterAll,
    status: () => current,
  }
}
