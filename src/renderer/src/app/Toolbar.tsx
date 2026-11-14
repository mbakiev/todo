import { Check, ListFilter, Plus, Search, Tag as TagIcon, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
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

function SearchBox() {
  const text = useUiStore((s) => s.filter.text)
  const setSearchText = useUiStore((s) => s.setSearchText)
  const focusRequest = useUiStore((s) => s.searchFocusRequest)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (focusRequest > 0) {
      ref.current?.focus()
      ref.current?.select()
    }
  }, [focusRequest])

  return (
    <div className="app-no-drag relative w-56 min-w-28 shrink">
      <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={ref}
        type="search"
        aria-label="Search tasks"
        placeholder={`Search  ${modKeyLabel()}F`}
        value={text}
        onChange={(e) => setSearchText(e.target.value)}
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
  )
}

function TagFilter() {
  const tags = useTags()
  const selected = useUiStore((s) => s.filter.tagIds)
  const toggle = useUiStore((s) => s.toggleFilterTag)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'app-no-drag h-7 gap-1.5 px-2 text-[13px] font-normal',
            selected.length > 0 && 'bg-selection text-primary',
          )}
        >
          <TagIcon className="size-3.5" />
          Tags
          {selected.length > 0 && <span className="tabular-nums">· {selected.length}</span>}
        </Button>
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
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'app-no-drag h-7 gap-1.5 px-2 text-[13px] font-normal',
            selected.length > 0 && 'bg-selection text-primary',
          )}
        >
          <ListFilter className="size-3.5" />
          Priority
          {selected.length > 0 && <span className="tabular-nums">· {selected.length}</span>}
        </Button>
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
    <header className="app-drag flex h-12 shrink-0 items-center gap-2 border-b px-4">
      <h1 className="mr-2 shrink-0 text-sm font-semibold whitespace-nowrap">
        {VIEW_LABELS[activeView]}
      </h1>
      {/* View-specific controls are portalled here. */}
      <div
        ref={slotRef}
        className="app-no-drag flex shrink-0 items-center gap-1"
        data-slot="toolbar-controls"
      />
      <div className="min-w-2 flex-1" />
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
            className="app-no-drag ml-1 h-7 gap-1 px-2.5 text-[13px]"
            onClick={() => openNewTaskDialog()}
          >
            <Plus className="size-3.5" />
            New task
          </Button>
        </TooltipTrigger>
        <TooltipContent>{modKeyLabel()}N</TooltipContent>
      </Tooltip>
    </header>
  )
}
