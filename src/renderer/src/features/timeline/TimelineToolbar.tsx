import { CircleCheck, Rows3 } from 'lucide-react'
import { ToolbarControls } from '@/app/ToolbarControls'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { ZOOMS, ZOOM_LABELS, type Zoom } from './timelineGeometry'
import { GROUP_BY_LABELS, type GroupBy } from './timelineRows'

const GROUP_BYS: readonly GroupBy[] = ['none', 'status', 'priority']

export interface TimelineToolbarProps {
  zoom: Zoom
  onZoom(zoom: Zoom): void
  onToday(): void
  groupBy: GroupBy
  onGroupBy(groupBy: GroupBy): void
  showCompleted: boolean
  onShowCompleted(show: boolean): void
}

export function TimelineToolbar({
  zoom,
  onZoom,
  onToday,
  groupBy,
  onGroupBy,
  showCompleted,
  onShowCompleted,
}: TimelineToolbarProps) {
  return (
    <ToolbarControls>
      <ToggleGroup
        type="single"
        value={zoom}
        onValueChange={(v) => {
          if (v) onZoom(v as Zoom)
        }}
        aria-label="Zoom"
        className="h-7 gap-0.5 rounded-md bg-muted p-0.5"
      >
        {ZOOMS.map((z) => (
          <ToggleGroupItem
            key={z}
            value={z}
            data-zoom={z}
            className="h-6 min-w-0 rounded-[5px] px-2 text-xs font-normal text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:font-medium data-[state=on]:text-foreground data-[state=on]:shadow-xs"
          >
            {ZOOM_LABELS[z]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-[13px] font-normal"
        onClick={onToday}
      >
        Today
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Group by"
            className={cn(
              'h-7 gap-1.5 px-2 text-[13px] font-normal',
              groupBy !== 'none' && 'bg-selection text-primary',
            )}
          >
            <Rows3 className="size-3.5" />
            {groupBy === 'none' ? 'Group' : GROUP_BY_LABELS[groupBy]}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-40">
          <DropdownMenuRadioGroup value={groupBy} onValueChange={(v) => onGroupBy(v as GroupBy)}>
            {GROUP_BYS.map((g) => (
              <DropdownMenuRadioItem key={g} value={g}>
                {GROUP_BY_LABELS[g]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="ghost"
        size="sm"
        aria-pressed={showCompleted}
        aria-label="Show completed"
        className={cn(
          'h-7 gap-1.5 px-2 text-[13px] font-normal',
          showCompleted && 'bg-selection text-primary',
        )}
        onClick={() => onShowCompleted(!showCompleted)}
      >
        <CircleCheck className="size-3.5" />
        Completed
      </Button>
    </ToolbarControls>
  )
}
