import { Settings as SettingsIcon } from 'lucide-react'
import { useMemo } from 'react'
import { APP_DISPLAY_NAME, VIEW_IDS, VIEW_LABELS } from '@shared/constants'
import type { ViewId } from '@shared/types'
import { filterTodayBoard, filterWeekBoard, isOpen } from '@shared/views'
import { TAG_DOT_CLASS } from '@/components/task'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { isMac } from '@/lib/platform'
import { formatShortcut } from '@/lib/shortcuts'
import { useToday } from '@/lib/useToday'
import { cn } from '@/lib/utils'
import { useSettings, useTags, useTasks } from '@/stores/selectors'
import { useUiStore } from '@/stores/uiStore'
import { VIEW_ICONS } from './viewMeta'

function useOpenCounts(): Partial<Record<ViewId, number>> {
  const tasks = useTasks()
  const today = useToday()
  const settings = useSettings()
  return useMemo(
    () => ({
      today: filterTodayBoard(tasks, today).filter(isOpen).length,
      week: filterWeekBoard(tasks, today, settings).filter(isOpen).length,
    }),
    [tasks, today, settings],
  )
}

export function Sidebar() {
  const activeView = useUiStore((s) => s.activeView)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const filterTagIds = useUiStore((s) => s.filter.tagIds)
  const toggleFilterTag = useUiStore((s) => s.toggleFilterTag)
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)
  const tags = useTags()
  const counts = useOpenCounts()
  const mac = isMac()

  return (
    <nav
      aria-label="Views"
      className="flex w-52 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
    >
      {/* Title-bar area: draggable; leaves room for the macOS traffic lights. */}
      <div className={cn('app-drag flex h-12 shrink-0 items-center px-4', mac && 'pl-[84px]')}>
        {!mac && (
          <span className="text-[13px] font-semibold text-foreground">{APP_DISPLAY_NAME}</span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 scrollbar-thin flex-col gap-4 overflow-y-auto px-2 pb-2">
        <ul className="flex flex-col gap-px">
          {VIEW_IDS.map((view, i) => {
            const Icon = VIEW_ICONS[view]
            const active = view === activeView
            const count = counts[view]
            return (
              <li key={view}>
                <Tooltip delayDuration={700}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      data-view={view}
                      aria-current={active ? 'page' : undefined}
                      onClick={() => setActiveView(view)}
                      className={cn(
                        'flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] outline-none',
                        'hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50',
                        active && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
                      )}
                    >
                      <Icon
                        className={cn(
                          'size-4 shrink-0',
                          active ? 'text-primary' : 'text-muted-foreground',
                        )}
                      />
                      <span className="flex-1 truncate text-left">{VIEW_LABELS[view]}</span>
                      {count !== undefined && count > 0 && (
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          {count}
                        </span>
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{formatShortcut(`Mod+${i + 1}`)}</TooltipContent>
                </Tooltip>
              </li>
            )
          })}
        </ul>

        <section aria-label="Tags">
          <h2 className="px-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Tags
          </h2>
          {tags.length === 0 ? (
            <p className="px-2 text-xs text-muted-foreground">
              Add #tags to tasks to filter by them.
            </p>
          ) : (
            <ul className="flex flex-col gap-px">
              {tags.map((tag) => {
                const active = filterTagIds.includes(tag.id)
                return (
                  <li key={tag.id}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleFilterTag(tag.id)}
                      className={cn(
                        'flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] outline-none',
                        'hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50',
                        active && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
                      )}
                    >
                      <span
                        className={cn(
                          'ml-1 size-2 shrink-0 rounded-full',
                          TAG_DOT_CLASS[tag.color],
                        )}
                      />
                      <span className="flex-1 truncate text-left">{tag.name}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      <div className="shrink-0 border-t border-sidebar-border p-2">
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] outline-none hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <SettingsIcon className="size-4 text-muted-foreground" />
          <span className="flex-1 text-left">Settings</span>
          <span className="text-[11px] text-muted-foreground">{formatShortcut('Mod+,')}</span>
        </button>
      </div>
    </nav>
  )
}
