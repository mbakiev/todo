import { toast } from 'sonner'
import { create } from 'zustand'
import { DEFAULT_SETTINGS } from '@shared/constants'
import type { SettingsPatch } from '@shared/schemas'
import type { Settings } from '@shared/types'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/errors'

// Optimistic like tasksStore: `settings` is the newest server copy (`confirmed`) with the
// patches still in flight merged on top, so a failed or late answer for one patch never
// reverts another (or a change broadcast from another window).

export interface SettingsState {
  settings: Settings
  /** Newest settings from main (load, results, broadcasts). */
  confirmed: Settings
  /** Patches awaiting main, in issue order. */
  ops: { seq: number; patch: SettingsPatch }[]
  loaded: boolean
  load(): Promise<void>
  /** Optimistic; nested `shortcuts` / `boardSort` merge one level deep (like main). */
  set(patch: SettingsPatch): Promise<Settings | null>
  /** Apply a `settingsChanged` broadcast. */
  apply(settings: Settings): void
}

function merge(cur: Settings, patch: SettingsPatch): Settings {
  const next = { ...cur } as Record<string, unknown>
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    next[k] =
      (k === 'shortcuts' || k === 'boardSort') && v !== null && typeof v === 'object'
        ? { ...(cur[k] as object), ...v }
        : v
  }
  return next as unknown as Settings
}

let nextSeq = 1

const replay = (base: Settings, ops: SettingsState['ops']): Settings =>
  ops.reduce((acc, op) => merge(acc, op.patch), base)

export const useSettingsStore = create<SettingsState>()((set) => ({
  settings: DEFAULT_SETTINGS,
  confirmed: DEFAULT_SETTINGS,
  ops: [],
  loaded: false,

  async load() {
    const settings = await api().settings.get()
    set((s) => ({ confirmed: settings, settings: replay(settings, s.ops), loaded: true }))
  },

  async set(patch) {
    const seq = nextSeq++
    set((s) => {
      const ops = [...s.ops, { seq, patch }]
      return { ops, settings: replay(s.confirmed, ops) }
    })
    const settle = (server: Settings | null): void =>
      set((s) => {
        const confirmed = server ?? s.confirmed
        const ops = s.ops.filter((o) => o.seq !== seq)
        return { confirmed, ops, settings: replay(confirmed, ops) }
      })
    try {
      const settings = await api().settings.set(patch)
      settle(settings)
      return settings
    } catch (err) {
      settle(null)
      toast.error("Couldn't save settings", { description: errorMessage(err) })
      return null
    }
  },

  apply(settings) {
    set((s) => ({ confirmed: settings, settings: replay(settings, s.ops) }))
  },
}))
