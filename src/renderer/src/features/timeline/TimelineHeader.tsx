import { memo } from 'react'
import type { LocalDate, WeekStartsOn } from '@shared/types'
import { cn } from '@/lib/utils'
import { DAY_WIDTH, dateToX, headerTiers, type DateRange, type Zoom } from './timelineGeometry'

export const HEADER_TOP_H = 22
export const HEADER_BOTTOM_H = 24
export const HEADER_H = HEADER_TOP_H + HEADER_BOTTOM_H

export interface TimelineHeaderProps {
  range: DateRange
  zoom: Zoom
  today: LocalDate
  weekStartsOn: WeekStartsOn
  leftPaneWidth: number
  /** Content shown in the sticky top-left corner. */
  corner: React.ReactNode
}

/** Sticky two-tier date header (month over day/week; year over month at Month zoom). */
export const TimelineHeader = memo(function TimelineHeader({
  range,
  zoom,
  today,
  weekStartsOn,
  leftPaneWidth,
  corner,
}: TimelineHeaderProps) {
  const { top, bottom } = headerTiers(range, zoom, today, weekStartsOn)
  const dw = DAY_WIDTH[zoom]
  const todayX = dateToX(today, range.start, dw) + dw / 2

  return (
    <div
      className="sticky top-0 z-20 flex border-b bg-background"
      style={{ height: HEADER_H }}
      data-testid="timeline-header"
    >
      <div
        className="sticky left-0 z-10 flex shrink-0 items-end border-r bg-background px-3 pb-1.5"
        style={{ width: leftPaneWidth }}
      >
        {corner}
      </div>
      <div className="relative shrink-0" style={{ width: bottom.reduce((w, c) => w + c.width, 0) }}>
        {/* Top tier: label sticks to the left edge while its segment is in view. */}
        <div className="absolute inset-x-0 top-0 flex" style={{ height: HEADER_TOP_H }}>
          {top.map((c) => (
            <div
              key={c.key}
              className="relative shrink-0 border-l border-border/60 first:border-l-0"
              style={{ width: c.width }}
            >
              <span
                className="sticky inline-block px-2 pt-1 text-[11px] font-medium whitespace-nowrap text-foreground/80"
                style={{ left: leftPaneWidth }}
              >
                {c.label}
              </span>
            </div>
          ))}
        </div>
        <div
          className="absolute inset-x-0 bottom-0 flex"
          style={{ height: HEADER_BOTTOM_H }}
          data-testid="timeline-header-ticks"
        >
          {bottom.map((c) => (
            <div
              key={c.key}
              data-date={c.start}
              className={cn(
                'flex shrink-0 items-center overflow-hidden text-[11px] whitespace-nowrap text-muted-foreground tabular-nums',
                zoom === 'day' ? 'justify-center' : 'border-l border-border/60 pl-1.5',
                c.weekend && 'text-muted-foreground/60',
              )}
              style={{ width: c.width }}
            >
              {zoom === 'day' && c.today ? (
                <span className="rounded-[4px] bg-primary px-1 leading-4 font-medium text-primary-foreground">
                  {c.label}
                </span>
              ) : (
                <>
                  {c.sub && <span className="mr-0.5 text-[10px] opacity-70">{c.sub[0]}</span>}
                  {c.label}
                </>
              )}
            </div>
          ))}
        </div>
        {zoom !== 'day' && (
          <span
            aria-hidden
            className="absolute bottom-0 size-1.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-primary"
            style={{ left: todayX }}
          />
        )}
      </div>
    </div>
  )
})
