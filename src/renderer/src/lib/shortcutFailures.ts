// Which global-shortcut registration failures still need to be announced with a toast
// (the main window shows one when it is on screen and a shortcut failed to register).
// Pure; the toast and its triggers live in app/useShortcutFailureToast.ts.
import { GLOBAL_SHORTCUT_LABELS } from '@shared/constants'
import type { Settings, ShortcutStatus } from '@shared/types'

export type ShortcutName = keyof Settings['shortcuts']

export interface ShortcutFailure {
  name: ShortcutName
  accelerator: string
  error: string
}

const NAMES: readonly ShortcutName[] = ['quickAdd', 'toggleApp']

/** One key per shortcut *and* combo: changing the combo makes a new failure announceable. */
export const failureKey = (f: Pick<ShortcutFailure, 'name' | 'accelerator'>): string =>
  `${f.name}\u0000${f.accelerator}`

/**
 * Failures not yet announced in this app run. A shortcut the user turned off (empty
 * accelerator) never counts, nor does one that is merely suspended while being recorded.
 */
export function failuresToAnnounce(
  status: ShortcutStatus,
  announced: ReadonlySet<string>,
): ShortcutFailure[] {
  const out: ShortcutFailure[] = []
  for (const name of NAMES) {
    const s = status[name]
    if (s.accelerator === '' || s.registered || !s.error) continue
    const f = { name, accelerator: s.accelerator, error: s.error }
    if (!announced.has(failureKey(f))) out.push(f)
  }
  return out
}

/** Toast text: names the shortcut, its combo (already formatted) and the reason. */
export function failureMessage(
  failures: readonly ShortcutFailure[],
  format: (accelerator: string) => string,
): { title: string; description: string } {
  const one = failures.length === 1 ? failures[0] : undefined
  if (one) {
    return {
      title: `The ${GLOBAL_SHORTCUT_LABELS[one.name]} shortcut ${format(one.accelerator)} isn't working`,
      description: `${one.error}. Pick another combination in Settings.`,
    }
  }
  return {
    title: `${failures.length} global shortcuts aren't working`,
    description: failures
      .map((f) => `${GLOBAL_SHORTCUT_LABELS[f.name]} (${format(f.accelerator)}): ${f.error}.`)
      .join(' '),
  }
}

/** sessionStorage: kept across a reload of the window, gone when the app quits. */
const STORAGE_KEY = 'martin-todos.announcedShortcutFailures'

export function loadAnnounced(storage: Storage | null): Set<string> {
  try {
    const raw = storage?.getItem(STORAGE_KEY)
    const list: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

export function saveAnnounced(storage: Storage | null, announced: ReadonlySet<string>): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify([...announced]))
  } catch {
    // ignore: at worst the toast shows again after a reload
  }
}
