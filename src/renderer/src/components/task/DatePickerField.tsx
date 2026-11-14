// Date field: a button showing the date that opens a calendar popover with presets.
import { CalendarDays, X } from 'lucide-react'
import { useState } from 'react'
import {
  formatRelativeDate,
  localDateToDate,
  presetDate,
  toLocalDate,
  type DatePreset,
} from '@shared/dates'
import type { LocalDate } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useToday } from '@/lib/useToday'
import { useSettings } from '@/stores/selectors'

const PRESETS: Array<{ preset: DatePreset; label: string }> = [
  { preset: 'today', label: 'Today' },
  { preset: 'tomorrow', label: 'Tomorrow' },
  { preset: 'nextWeek', label: 'Next week' },
]

export interface DatePickerFieldProps {
  value: LocalDate | null
  onChange(value: LocalDate | null): void
  placeholder?: string
  /** Colour the label (e.g. red when overdue). */
  tone?: 'default' | 'overdue' | 'today'
  /** Disable dates before this one (e.g. due ≥ start). */
  min?: LocalDate | null
  /** Disable dates after this one (e.g. start ≤ due). */
  max?: LocalDate | null
  className?: string
  disabled?: boolean
  align?: 'start' | 'center' | 'end'
}

export function DatePickerField({
  value,
  onChange,
  placeholder = 'No date',
  tone = 'default',
  min,
  max,
  className,
  disabled,
  align = 'start',
}: DatePickerFieldProps) {
  const [open, setOpen] = useState(false)
  const today = useToday()
  const { weekStartsOn } = useSettings()
  const pick = (v: LocalDate | null): void => {
    onChange(v)
    setOpen(false)
  }
  const outOfRange = (d: LocalDate): boolean => (!!min && d < min) || (!!max && d > max)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          className={cn(
            'h-7 justify-start gap-1.5 px-2 text-[13px] font-normal',
            !value && 'text-muted-foreground',
            value && tone === 'overdue' && 'text-overdue',
            value && tone === 'today' && 'text-due-today',
            className,
          )}
        >
          <CalendarDays className="size-3.5" />
          {value ? formatRelativeDate(value, today) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-auto p-0">
        <div className="flex flex-wrap gap-1 border-b p-2">
          {PRESETS.map(({ preset, label }) => {
            const d = presetDate(preset, today, weekStartsOn)
            return (
              <Button
                key={preset}
                variant="secondary"
                size="sm"
                className="h-6 px-2 text-xs"
                disabled={outOfRange(d)}
                onClick={() => pick(d)}
              >
                {label}
              </Button>
            )
          })}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-xs text-muted-foreground"
            disabled={!value}
            onClick={() => pick(null)}
          >
            <X className="size-3" />
            Clear
          </Button>
        </div>
        <Calendar
          mode="single"
          weekStartsOn={weekStartsOn}
          selected={value ? localDateToDate(value) : undefined}
          defaultMonth={localDateToDate(value ?? today)}
          disabled={(date: Date) => outOfRange(toLocalDate(date))}
          onSelect={(date: Date | undefined) => pick(date ? toLocalDate(date) : null)}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  )
}
