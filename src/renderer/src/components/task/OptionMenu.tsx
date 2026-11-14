// Small internal helper: a dropdown of options with a check mark on the current value.
import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export interface OptionMenuProps<T extends string | number> {
  value: T
  options: ReadonlyArray<{ value: T; label: string; icon: ReactNode }>
  onChange(value: T): void
  trigger: ReactNode
  align?: 'start' | 'center' | 'end'
}

export function OptionMenu<T extends string | number>({
  value,
  options,
  onChange,
  trigger,
  align = 'start',
}: OptionMenuProps<T>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-40">
        {options.map((o) => (
          <DropdownMenuItem key={String(o.value)} onSelect={() => onChange(o.value)}>
            {o.icon}
            <span className="flex-1">{o.label}</span>
            {o.value === value && <Check className="size-3.5 text-muted-foreground" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
