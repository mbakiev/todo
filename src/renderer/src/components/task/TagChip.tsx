import { X } from 'lucide-react'
import type { Tag } from '@shared/types'
import { cn } from '@/lib/utils'
import { TAG_CHIP_CLASS } from './tagColors'

export interface TagChipProps {
  tag: Pick<Tag, 'name' | 'color'>
  /** Shows an × button. */
  onRemove?(): void
  size?: 'sm' | 'md'
  className?: string
}

export function TagChip({ tag, onRemove, size = 'sm', className }: TagChipProps) {
  return (
    <span
      className={cn(
        'inline-flex max-w-40 items-center gap-0.5 rounded-sm font-medium whitespace-nowrap',
        size === 'sm' ? 'h-[18px] px-1.5 text-[11px]' : 'h-6 px-2 text-xs',
        TAG_CHIP_CLASS[tag.color],
        className,
      )}
    >
      <span className="truncate">{tag.name}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove tag ${tag.name}`}
          className="-mr-1 ml-0.5 rounded-sm p-0.5 opacity-60 hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  )
}
