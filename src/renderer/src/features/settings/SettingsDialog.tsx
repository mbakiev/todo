// Settings dialog (spec §9): General, Shortcuts, Tags, Data — left nav inside the dialog,
// with the app name and version at the bottom. Mounted by the shell, driven by
// uiStore.settingsOpen.
import { Database, Keyboard, SlidersHorizontal, Tag as TagIcon, X } from 'lucide-react'
import { useEffect, useState, type ComponentType } from 'react'
import { APP_DISPLAY_NAME } from '@shared/constants'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { appInfo } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/uiStore'
import { DataSection } from './DataSection'
import { GeneralSection } from './GeneralSection'
import { ShortcutsSection } from './ShortcutsSection'
import { TagsSection } from './TagsSection'

type SectionId = 'general' | 'shortcuts' | 'tags' | 'data'

const SECTIONS: Array<{
  id: SectionId
  label: string
  icon: ComponentType<{ className?: string }>
}> = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'tags', label: 'Tags', icon: TagIcon },
  { id: 'data', label: 'Data & backup', icon: Database },
]

const CONTENT: Record<SectionId, ComponentType> = {
  general: GeneralSection,
  shortcuts: ShortcutsSection,
  tags: TagsSection,
  data: DataSection,
}

export function SettingsDialog() {
  const open = useUiStore((s) => s.settingsOpen)
  const setOpen = useUiStore((s) => s.setSettingsOpen)
  const [section, setSection] = useState<SectionId>('general')
  const { version, isDev } = appInfo()
  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]
  const Content = CONTENT[section]

  // Re-open on General next time unless the dialog is reopened right away.
  useEffect(() => {
    if (!open) return
    return () => setSection('general')
  }, [open])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(560px,calc(100vh-4rem))] gap-0 overflow-hidden p-0 sm:max-w-[780px]"
        data-testid="settings-dialog"
      >
        <nav
          aria-label="Settings sections"
          className="flex w-48 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-2"
        >
          <DialogTitle className="px-2 pt-2 pb-3 text-[13px] font-semibold">Settings</DialogTitle>
          <DialogDescription className="sr-only">
            Appearance, shortcuts, tags, and data for {APP_DISPLAY_NAME}.
          </DialogDescription>
          <ul className="flex flex-col gap-px">
            {SECTIONS.map(({ id, label, icon: Icon }) => {
              const active = id === section
              return (
                <li key={id}>
                  <button
                    type="button"
                    data-section={id}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setSection(id)}
                    className={cn(
                      'flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] text-sidebar-foreground outline-none',
                      'hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50',
                      active && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
                    )}
                  >
                    <Icon
                      className={cn('size-4', active ? 'text-primary' : 'text-muted-foreground')}
                    />
                    {label}
                  </button>
                </li>
              )
            })}
          </ul>
          <div
            className="mt-auto px-2 pb-1 text-[11px] leading-4 text-muted-foreground"
            data-testid="about"
          >
            <div className="font-medium text-foreground/80">{APP_DISPLAY_NAME}</div>
            <div>
              Version {version}
              {isDev && ' · development'}
            </div>
          </div>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center justify-between border-b px-5">
            <h2 className="text-sm font-semibold">{current?.label}</h2>
            <Button
              variant="ghost"
              size="icon-sm"
              className="-mr-2 size-7"
              aria-label="Close settings"
              onClick={() => setOpen(false)}
            >
              <X className="size-4" />
            </Button>
          </header>
          <div
            className="min-h-0 flex-1 scrollbar-thin overflow-y-auto px-5 py-4"
            data-section-content={section}
          >
            <Content />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
