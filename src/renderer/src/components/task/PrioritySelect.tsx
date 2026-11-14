import { PRIORITIES, PRIORITY_LABELS } from '@shared/constants'
import type { Priority } from '@shared/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { OptionMenu } from './OptionMenu'
import { PriorityIcon } from './PriorityIcon'

const OPTIONS = PRIORITIES.map((p) => ({
  value: p,
  label: PRIORITY_LABELS[p],
  icon: <PriorityIcon priority={p} />,
}))

export interface PrioritySelectProps {
  value: Priority
  onChange(priority: Priority): void
  /** Icon-only trigger (for dense rows / table cells). */
  compact?: boolean
  className?: string
  disabled?: boolean
}

export function PrioritySelect({
  value,
  onChange,
  compact,
  className,
  disabled,
}: PrioritySelectProps) {
  return (
    <OptionMenu
      value={value}
      options={OPTIONS}
      onChange={onChange}
      trigger={
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          className={cn(
            'h-7 gap-1.5 px-2 text-[13px] font-normal',
            compact && 'w-7 px-0',
            className,
          )}
          aria-label={`Priority: ${PRIORITY_LABELS[value]}`}
        >
          <PriorityIcon priority={value} />
          {!compact && PRIORITY_LABELS[value]}
        </Button>
      }
    />
  )
}
