import { cn } from '@/lib/utils'
import { useTaskTags } from '@/stores/selectors'
import { TagChip } from './TagChip'

export interface TaskTagsProps {
  tagIds: readonly string[]
  /** Show at most this many chips, then "+N". */
  max?: number
  className?: string
}

/** Renders a task's tag chips (resolved via the tags store, alphabetical by name). */
export function TaskTags({ tagIds, max = 3, className }: TaskTagsProps) {
  const tags = useTaskTags(tagIds)
  if (tags.length === 0) return null
  const shown = tags.slice(0, max)
  const rest = tags.length - shown.length
  return (
    <span className={cn('inline-flex min-w-0 flex-wrap items-center gap-1', className)}>
      {shown.map((t) => (
        <TagChip key={t.id} tag={t} />
      ))}
      {rest > 0 && <span className="text-[11px] text-muted-foreground">+{rest}</span>}
    </span>
  )
}
