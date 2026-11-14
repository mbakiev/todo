// Small presentational pieces shared by the Settings sections.
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function SectionHeading({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div className="mb-1">
      <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
      {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
    </div>
  )
}

export function SettingRow({
  label,
  description,
  children,
  className,
}: {
  label: ReactNode
  description?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-4 py-3', className)}>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-foreground">{label}</div>
        {description && <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted/60 px-1.5 font-sans text-[11px] leading-none font-medium text-foreground/80 shadow-[0_1px_0_var(--border)]',
        className,
      )}
    >
      {children}
    </kbd>
  )
}

export function KeyCombo({ parts, className }: { parts: string[]; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      {parts.map((p, i) => (
        <Kbd key={`${p}-${i}`}>{p}</Kbd>
      ))}
    </span>
  )
}

/** Outcome line under an action (export path, import counts, backup path…). */
export function ResultNote({
  children,
  tone = 'default',
}: {
  children: ReactNode
  tone?: 'default' | 'error'
}) {
  return (
    <div
      role="status"
      className={cn(
        'selectable mt-2 rounded-md border px-3 py-2 text-xs break-all',
        tone === 'error'
          ? 'border-destructive/30 bg-destructive/5 text-destructive'
          : 'bg-muted/50 text-muted-foreground',
      )}
    >
      {children}
    </div>
  )
}
