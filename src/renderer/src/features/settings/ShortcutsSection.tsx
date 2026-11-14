import { AlertTriangle, CheckCircle2, RotateCcw, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { acceleratorsEqual } from '@shared/accelerators'
import { DEFAULT_SETTINGS, GLOBAL_SHORTCUT_LABELS as LABELS } from '@shared/constants'
import type { Settings, ShortcutStatus } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { appInfo } from '@/lib/platform'
import { shortcutParts } from '@/lib/shortcuts'
import { useSettings } from '@/stores/selectors'
import { useSettingsStore } from '@/stores/settingsStore'
import { KeyCombo, SectionHeading } from './parts'
import { ShortcutRecorder } from './ShortcutRecorder'

type Name = keyof Settings['shortcuts']

const GLOBAL: Array<{ name: Name; label: string; description: string }> = [
  {
    name: 'quickAdd',
    label: LABELS.quickAdd,
    description: 'Opens the small capture window from anywhere.',
  },
  {
    name: 'toggleApp',
    label: LABELS.toggleApp,
    description: 'Brings the main window forward, or hides it when it is in front.',
  },
]

function useShortcutStatus(): ShortcutStatus | null {
  const [status, setStatus] = useState<ShortcutStatus | null>(null)
  useEffect(() => {
    let alive = true
    void api()
      .app.getShortcutStatus()
      .then((s) => alive && setStatus(s))
    const off = api().on.shortcutStatusChanged(setStatus)
    return () => {
      alive = false
      off()
    }
  }, [])
  return status
}

function StatusLine({
  name,
  status,
  value,
}: {
  name: Name
  status: ShortcutStatus | null
  value: string
}) {
  const s = status?.[name]
  if (value === '') return <span className="text-[11px] text-muted-foreground">Disabled</span>
  if (!s || s.accelerator !== value) return null
  if (s.error) {
    return (
      <span className="flex items-center gap-1 text-[11px] text-destructive" role="alert">
        <AlertTriangle className="size-3" />
        {s.error}
      </span>
    )
  }
  if (s.registered) {
    return (
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <CheckCircle2 className="size-3 text-status-done" />
        Active
      </span>
    )
  }
  return null
}

export function ShortcutsSection() {
  const settings = useSettings()
  const set = useSettingsStore((s) => s.set)
  const status = useShortcutStatus()
  const platform = appInfo().platform
  const setShortcut = (name: Name, accelerator: string): void => {
    const patch: Partial<Settings['shortcuts']> = { [name]: accelerator }
    void set({ shortcuts: patch })
  }

  const validateFor = useCallback(
    (name: Name) =>
      (accel: string): string | null => {
        const other: Name = name === 'quickAdd' ? 'toggleApp' : 'quickAdd'
        return acceleratorsEqual(accel, settings.shortcuts[other], platform)
          ? `Already used for “${LABELS[other]}”`
          : null
      },
    [settings.shortcuts, platform],
  )

  const inApp: Array<{ label: string; parts: string[] }> = [
    { label: 'New task', parts: shortcutParts('Mod+N') },
    { label: 'Search', parts: shortcutParts('Mod+F') },
    { label: 'Switch view', parts: [...shortcutParts('Mod+1').slice(0, -1), '1 – 6'] },
    { label: 'Settings', parts: shortcutParts('Mod+,') },
    { label: 'Close panel or dialog', parts: shortcutParts('Escape') },
    { label: 'Quick add: save', parts: shortcutParts('Return') },
    { label: 'Quick add: save from the notes field', parts: shortcutParts('Mod+Return') },
    { label: 'New task dialog: save and add another', parts: shortcutParts('Mod+Shift+Return') },
  ]

  return (
    <div className="flex flex-col gap-6">
      <section>
        <SectionHeading
          title="Global shortcuts"
          description="Work from any app. Click a shortcut, then press the new key combination."
        />
        <div className="divide-y">
          {GLOBAL.map(({ name, label, description }) => {
            const value = settings.shortcuts[name]
            const isDefault = value === DEFAULT_SETTINGS.shortcuts[name]
            const s = status?.[name]
            const failing = !!s?.error && s.accelerator === value
            return (
              <div
                key={name}
                className="flex items-start gap-4 py-3"
                data-testid={`shortcut-${name}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[13px]">{label}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
                  <div className="mt-1">
                    <StatusLine name={name} status={status} value={value} />
                  </div>
                </div>
                <ShortcutRecorder
                  label={label}
                  value={value}
                  invalid={failing}
                  validate={validateFor(name)}
                  onChange={(accel) => setShortcut(name, accel)}
                />
                <div className="flex pt-0.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="size-7"
                        aria-label={`Reset ${label} to default`}
                        disabled={isDefault}
                        onClick={() => {
                          const def = DEFAULT_SETTINGS.shortcuts[name]
                          if (validateFor(name)(def)) return
                          setShortcut(name, def)
                        }}
                      >
                        <RotateCcw className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Reset to default</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="size-7"
                        aria-label={`Disable ${label}`}
                        disabled={value === ''}
                        onClick={() => setShortcut(name, '')}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Disable</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section>
        <SectionHeading title="In-app shortcuts" />
        <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-[13px]">
          {inApp.map(({ label, parts }) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="justify-self-end">
                <KeyCombo parts={parts} />
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}
