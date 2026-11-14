import { CircleCheck, Rows3 } from 'lucide-react'
import {
  SEGMENT_CLASS,
  SEGMENTED_CLASS,
  ToolbarButton,
  ToolbarControls,
} from '@/app/ToolbarControls'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
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
        className={SEGMENTED_CLASS}
      >
        {ZOOMS.map((z) => (
          <ToggleGroupItem
            key={z}
            value={z}
            data-zoom={z}
            className={SEGMENT_CLASS}
          >
            {ZOOM_LABELS[z]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2.5 text-xs shadow-none"
        onClick={onToday}
        aria-label="Scroll to today"
      >
        Today
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ToolbarButton
            icon={<Rows3 className="size-3.5" />}
            label={groupBy === 'none' ? 'Group' : GROUP_BY_LABELS[groupBy]}
            hint={groupBy === 'none' ? 'Group rows' : `Grouped by ${GROUP_BY_LABELS[groupBy]}`}
            aria-label="Group by"
            active={groupBy !== 'none'}
          />
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
      <ToolbarButton
        icon={<CircleCheck className="size-3.5" />}
        label="Completed"
        hint={showCompleted ? 'Hide completed tasks' : 'Show completed tasks'}
        aria-pressed={showCompleted}
        aria-label="Show completed"
        active={showCompleted}
        onClick={() => onShowCompleted(!showCompleted)}
      />
    </ToolbarControls>
  )
}
