import { Monitor, Moon, Sun } from 'lucide-react'
import type { ThemeSetting, WeekStartsOn } from '@shared/types'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { appInfo } from '@/lib/platform'
import { useSettings } from '@/stores/selectors'
import { useSettingsStore } from '@/stores/settingsStore'
import { SettingRow } from './parts'

const THEMES: Array<{ value: ThemeSetting; label: string; icon: typeof Sun }> = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
]

const itemClass =
  'h-7 gap-1.5 px-3 text-xs data-[state=on]:bg-selection data-[state=on]:text-primary'

export function GeneralSection() {
  const settings = useSettings()
  const set = useSettingsStore((s) => s.set)
  const { isDev, platform } = appInfo()
  const loginSupported = platform === 'darwin' || platform === 'win32'

  return (
    <div className="divide-y">
      <SettingRow label="Appearance" description="System follows your OS light / dark setting.">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-label="Appearance"
          value={settings.theme}
          onValueChange={(v) => v && void set({ theme: v as ThemeSetting })}
        >
          {THEMES.map(({ value, label, icon: Icon }) => (
            <ToggleGroupItem
              key={value}
              value={value}
              className={itemClass}
              data-testid={`theme-${value}`}
            >
              <Icon className="size-3.5" />
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </SettingRow>

      <SettingRow
        label="Week starts on"
        description="Used by This Week, the calendar and date pickers."
      >
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-label="Week starts on"
          value={String(settings.weekStartsOn)}
          onValueChange={(v) => v && void set({ weekStartsOn: Number(v) as WeekStartsOn })}
        >
          <ToggleGroupItem value="1" className={itemClass} data-testid="week-monday">
            Monday
          </ToggleGroupItem>
          <ToggleGroupItem value="0" className={itemClass} data-testid="week-sunday">
            Sunday
          </ToggleGroupItem>
        </ToggleGroup>
      </SettingRow>

      <SettingRow
        label="Launch at login"
        description={
          !loginSupported
            ? 'Not available on this platform.'
            : isDev
              ? 'Available in the installed app (disabled in development builds).'
              : 'Starts quietly in the menu bar / system tray when you log in.'
        }
      >
        <Switch
          aria-label="Launch at login"
          checked={settings.launchAtLogin}
          disabled={isDev || !loginSupported}
          onCheckedChange={(v) => void set({ launchAtLogin: v })}
        />
      </SettingRow>
    </div>
  )
}
