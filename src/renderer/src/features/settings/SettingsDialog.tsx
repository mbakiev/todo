// PLACEHOLDER — owned by the desktop-shell/settings feature. Keep the export name; the shell
// mounts it, driven by uiStore.settingsOpen. Spec §9 "Settings".
import type { ThemeSetting, WeekStartsOn } from '@shared/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useSettings } from '@/stores/selectors'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'

export function SettingsDialog() {
  const open = useUiStore((s) => s.settingsOpen)
  const setOpen = useUiStore((s) => s.setSettingsOpen)
  const settings = useSettings()
  const set = useSettingsStore((s) => s.set)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Settings</DialogTitle>
          <DialogDescription className="text-xs">
            More settings arrive with the desktop-shell feature.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[120px_1fr] items-center gap-3 text-[13px]">
          <Label className="text-[13px]">Theme</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={settings.theme}
            onValueChange={(v) => v && void set({ theme: v as ThemeSetting })}
          >
            <ToggleGroupItem value="system" className="px-3 text-xs">
              System
            </ToggleGroupItem>
            <ToggleGroupItem value="light" className="px-3 text-xs">
              Light
            </ToggleGroupItem>
            <ToggleGroupItem value="dark" className="px-3 text-xs">
              Dark
            </ToggleGroupItem>
          </ToggleGroup>
          <Label className="text-[13px]">Week starts on</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={String(settings.weekStartsOn)}
            onValueChange={(v) => v && void set({ weekStartsOn: Number(v) as WeekStartsOn })}
          >
            <ToggleGroupItem value="1" className="px-3 text-xs">
              Monday
            </ToggleGroupItem>
            <ToggleGroupItem value="0" className="px-3 text-xs">
              Sunday
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </DialogContent>
    </Dialog>
  )
}
