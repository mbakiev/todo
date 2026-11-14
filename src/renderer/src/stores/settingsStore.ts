import { toast } from 'sonner'
import { create } from 'zustand'
import { DEFAULT_SETTINGS } from '@shared/constants'
import type { SettingsPatch } from '@shared/schemas'
import type { Settings } from '@shared/types'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/errors'

export interface SettingsState {
  settings: Settings
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

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  async load() {
    set({ settings: await api().settings.get(), loaded: true })
  },

  async set(patch) {
    const prev = get().settings
    set({ settings: merge(prev, patch) })
    try {
      const settings = await api().settings.set(patch)
      set({ settings })
      return settings
    } catch (err) {
      set({ settings: prev })
      toast.error("Couldn't save settings", { description: errorMessage(err) })
      return null
    }
  },

  apply(settings) {
    set({ settings })
  },
}))
