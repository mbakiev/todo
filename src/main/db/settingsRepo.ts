import { defaultSettings } from '@shared/constants'
import { settingsSchema, type SettingsPatchParsed } from '@shared/schemas'
import type { Platform, Settings } from '@shared/types'
import type { Db } from './connection'
import { RepoError } from './errors'

type SettingsKey = keyof Settings
const KEYS = Object.keys(defaultSettings('darwin')) as SettingsKey[]

/** Already-validated partial settings; `shortcuts` / `boardSort` may be partial too. */
export type SettingsPatchParams = SettingsPatchParsed

export interface SettingsRepo {
  get(): Settings
  /** Merges and persists; nested `shortcuts` and `boardSort` merge one level deep. */
  set(patch: SettingsPatchParams): Settings
}

/** `platform` picks the defaults for values never stored (the global shortcuts differ). */
export function createSettingsRepo(db: Db, platform: Platform = process.platform): SettingsRepo {
  const defaults = defaultSettings(platform)
  function read(): Settings {
    const rows = db.all<{ key: string; value: string }>('SELECT key, value FROM settings')
    const stored = new Map(rows.map((r) => [r.key, r.value]))
    const out: Record<string, unknown> = {}
    for (const key of KEYS) {
      const fallback = defaults[key]
      const raw = stored.get(key)
      if (raw === undefined) {
        out[key] = fallback
        continue
      }
      try {
        let value: unknown = JSON.parse(raw)
        // Merge nested objects with defaults so new sub-keys get default values.
        if (
          fallback !== null &&
          typeof fallback === 'object' &&
          value !== null &&
          typeof value === 'object'
        ) {
          value = { ...fallback, ...value }
        }
        const parsed = settingsSchema.shape[key].safeParse(value)
        out[key] = parsed.success ? parsed.data : fallback
      } catch {
        out[key] = fallback
      }
    }
    return settingsSchema.parse(out)
  }

  return {
    get: read,

    set(patch) {
      return db.transaction(() => {
        const current = read()
        const merged: Record<string, unknown> = { ...current }
        for (const key of Object.keys(patch) as SettingsKey[]) {
          const value = patch[key]
          if (value === undefined) continue
          const cur = current[key]
          merged[key] =
            (key === 'shortcuts' || key === 'boardSort') &&
            typeof value === 'object' &&
            value !== null
              ? { ...(cur as object), ...value }
              : value
        }
        const result = settingsSchema.safeParse(merged)
        if (!result.success)
          throw new RepoError('validation', `Invalid settings: ${result.error.message}`)
        for (const key of Object.keys(patch) as SettingsKey[]) {
          if (patch[key] === undefined) continue
          db.run(
            'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
            [key, JSON.stringify(result.data[key])],
          )
        }
        return result.data
      })
    },
  }
}
