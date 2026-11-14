import {
  CalendarDays,
  CalendarRange,
  ChartGantt,
  Layers,
  LayoutList,
  Sun,
  type LucideIcon,
} from 'lucide-react'
import type { ViewId } from '@shared/types'

export const VIEW_ICONS: Record<ViewId, LucideIcon> = {
  today: Sun,
  week: CalendarRange,
  everything: Layers,
  list: LayoutList,
  timeline: ChartGantt,
  calendar: CalendarDays,
}
