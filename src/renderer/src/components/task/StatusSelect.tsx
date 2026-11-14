import { STATUSES, STATUS_LABELS } from '@shared/constants'
import type { Status } from '@shared/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { OptionMenu } from './OptionMenu'
import { StatusIcon } from './StatusIcon'

const OPTIONS = STATUSES.map((s) => ({
  value: s,
  label: STATUS_LABELS[s],
  icon: <StatusIcon status={s} />,
}))

export interface StatusSelectProps {
  value: Status
  onChange(status: Status): void
  compact?: boolean
  className?: string
  disabled?: boolean
}

export function StatusSelect({ value, onChange, compact, className, disabled }: StatusSelectProps) {
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
          aria-label={`Status: ${STATUS_LABELS[value]}`}
        >
          <StatusIcon status={value} />
          {!compact && STATUS_LABELS[value]}
        </Button>
      }
    />
  )
}
