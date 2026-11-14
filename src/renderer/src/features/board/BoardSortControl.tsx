// Sort selector shown in the shell toolbar; persisted per board in settings.boardSort.
import type { BoardScope, BoardSort } from '@shared/types'
import { SEGMENT_CLASS, SEGMENTED_CLASS } from '@/app/ToolbarControls'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useSettingsStore } from '@/stores/settingsStore'

const SORTS: Array<{ value: BoardSort; label: string; hint: string }> = [
  { value: 'priority', label: 'Priority', hint: 'Highest priority first, then due date' },
  { value: 'due', label: 'Due', hint: 'Soonest due date first' },
  { value: 'manual', label: 'Manual', hint: 'Your own order — drag to rearrange' },
]

function isBoardSort(v: string): v is BoardSort {
  return SORTS.some((s) => s.value === v)
}

export function BoardSortControl({ scope, sort }: { scope: BoardScope; sort: BoardSort }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground @max-[960px]/toolbar:sr-only">Sort</span>
      <ToggleGroup
        type="single"
        className={SEGMENTED_CLASS}
        value={sort}
        onValueChange={(v) => {
          if (isBoardSort(v) && v !== sort) {
            void useSettingsStore.getState().set({ boardSort: { [scope]: v } })
          }
        }}
        aria-label="Sort"
      >
        {SORTS.map((s) => (
          <ToggleGroupItem
            key={s.value}
            value={s.value}
            title={s.hint}
            className={SEGMENT_CLASS}
          >
            {s.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}
