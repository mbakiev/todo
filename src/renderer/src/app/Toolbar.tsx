import { Check, ListFilter, Plus, Search, Tag as TagIcon, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { PRIORITIES, PRIORITY_LABELS, VIEW_LABELS } from '@shared/constants'
import { PriorityIcon, TAG_DOT_CLASS } from '@/components/task'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { modKeyLabel } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { useIsFilterActive, useTags } from '@/stores/selectors'
import { useUiStore } from '@/stores/uiStore'
import { ToolbarButton } from './ToolbarControls'

function SearchBox() {
  const text = useUiStore((s) => s.filter.text)
  const setSearchText = useUiStore((s) => s.setSearchText)
  const focusRequest = useUiStore((s) => s.searchFocusRequest)
  const ref = useRef<HTMLInputElement>(null)
  // Below 600px of toolbar width the box collapses to an icon; `expanded` overlays the input
  // on the toolbar row while it is in use (click or Cmd/Ctrl+F). Wider, it is always shown.
  // Every focus request expands it again; blur collapses it until the next request.
  const [collapsedAt, setCollapsedAt] = useState(0)
  const expanded = focusRequest > collapsedAt

  useEffect(() => {
    if (focusRequest > 0) {
      requestAnimationFrame(() => {
        ref.current?.focus()
        ref.current?.select()
      })
    }
  }, [focusRequest])

  return (
    <div className="app-no-drag flex w-56 min-w-36 shrink items-center @max-[700px]/toolbar:w-auto @max-[700px]/toolbar:min-w-0 @max-[700px]/toolbar:shrink-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Search tasks"
            className={cn(
              'hidden size-7 p-0 @max-[700px]/toolbar:inline-flex',
              text && 'bg-selection text-primary hover:bg-selection hover:text-primary',
            )}
            onClick={() => useUiStore.getState().requestSearchFocus()}
          >
            <Search className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {text ? `Search: ${text}` : 'Search'} · {modKeyLabel()}F
        </TooltipContent>
      </Tooltip>
      <div
        data-expanded={expanded || undefined}
        className={cn(
          'relative w-full',
          '@max-[700px]/toolbar:hidden',
          '@max-[700px]/toolbar:data-expanded:absolute @max-[700px]/toolbar:data-expanded:inset-y-0 @max-[700px]/toolbar:data-expanded:right-3 @max-[700px]/toolbar:data-expanded:z-10',
          '@max-[700px]/toolbar:data-expanded:flex @max-[700px]/toolbar:data-expanded:w-[min(18rem,calc(100cqw-1.5rem))] @max-[700px]/toolbar:data-expanded:items-center @max-[700px]/toolbar:data-expanded:bg-background',
        )}
      >
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={ref}
          type="search"
          aria-label="Search tasks"
          placeholder={`Search  ${modKeyLabel()}F`}
          value={text}
          onChange={(e) => setSearchText(e.target.value)}
          onBlur={() => setCollapsedAt(useUiStore.getState().searchFocusRequest)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              if (text) setSearchText('')
              else e.currentTarget.blur()
            }
          }}
          className="h-7 pl-7 text-[13px] shadow-none [&::-webkit-search-cancel-button]:hidden"
        />
      </div>
    </div>
  )
}

function TagFilter() {
  const tags = useTags()
  const selected = useUiStore((s) => s.filter.tagIds)
  const toggle = useUiStore((s) => s.toggleFilterTag)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <ToolbarButton
          icon={<TagIcon className="size-3.5" />}
          label={
            <>
              Tags
              {selected.length > 0 && <span className="tabular-nums"> · {selected.length}</span>}
            </>
          }
          hint={selected.length > 0 ? `Tag filter · ${selected.length} selected` : 'Filter by tag'}
          aria-label="Filter by tag"
          active={selected.length > 0}
        />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-0">
        <Command loop>
          <CommandInput placeholder="Filter by tag…" />
          <CommandList>
            <CommandEmpty className="py-3 text-center text-xs text-muted-foreground">
              No tags
            </CommandEmpty>
            <CommandGroup>
              {tags.map((t) => (
                <CommandItem key={t.id} value={t.name} onSelect={() => toggle(t.id)}>
                  <span className={cn('size-2 rounded-full', TAG_DOT_CLASS[t.color])} />
                  <span className="flex-1 truncate">{t.name}</span>
                  {selected.includes(t.id) && <Check className="size-3.5 text-muted-foreground" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function PriorityFilter() {
  const selected = useUiStore((s) => s.filter.priorities)
  const toggle = useUiStore((s) => s.toggleFilterPriority)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ToolbarButton
          icon={<ListFilter className="size-3.5" />}
          label={
            <>
              Priority
              {selected.length > 0 && <span className="tabular-nums"> · {selected.length}</span>}
            </>
          }
          hint={
            selected.length > 0
              ? `Priority filter · ${selected.length} selected`
              : 'Filter by priority'
          }
          aria-label="Filter by priority"
          active={selected.length > 0}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {PRIORITIES.map((p) => (
          <DropdownMenuCheckboxItem
            key={p}
            checked={selected.includes(p)}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => toggle(p)}
          >
            <PriorityIcon priority={p} />
            {PRIORITY_LABELS[p]}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export interface ToolbarProps {
  /** Receives the DOM node views portal their controls into (see ToolbarControls). */
  slotRef(el: HTMLDivElement | null): void
}

export function Toolbar({ slotRef }: ToolbarProps) {
  const activeView = useUiStore((s) => s.activeView)
  const openNewTaskDialog = useUiStore((s) => s.openNewTaskDialog)
  const clearFilter = useUiStore((s) => s.clearFilter)
  const filterActive = useIsFilterActive()

  return (
    <header className="@container/toolbar relative shrink-0 border-b">
      <div className="app-drag flex min-h-12 items-center gap-x-2 gap-y-1.5 px-4 py-2.5 @max-[520px]/toolbar:flex-wrap @max-[520px]/toolbar:px-3">
        <h1 className="mr-2 shrink-0 text-sm font-semibold whitespace-nowrap @max-[700px]/toolbar:sr-only @max-[520px]/toolbar:not-sr-only">
          {VIEW_LABELS[activeView]}
        </h1>
        {/* View-specific controls are portalled here. */}
        <div
          ref={slotRef}
          className="app-no-drag flex shrink-0 items-center gap-1 @max-[520px]/toolbar:order-last @max-[520px]/toolbar:w-full"
          data-slot="toolbar-controls"
        />
        <div className="min-w-2 flex-1 self-stretch" />
        <SearchBox />
        <TagFilter />
        <PriorityFilter />
        {filterActive && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="app-no-drag size-7 p-0"
                onClick={clearFilter}
                aria-label="Clear filters"
              >
                <X className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Clear filters</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              aria-label="New task"
              className="app-no-drag ml-1 h-7 gap-1 px-2.5 text-[13px] has-[>svg]:px-2.5 @max-[960px]/toolbar:w-7 @max-[960px]/toolbar:px-0 @max-[960px]/toolbar:has-[>svg]:px-0"
              onClick={() => openNewTaskDialog()}
            >
              <Plus className="size-3.5" />
              <span className="@max-[960px]/toolbar:sr-only">New task</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>New task · {modKeyLabel()}N</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}
