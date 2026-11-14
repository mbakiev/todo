// Timeline view preferences (zoom, grouping, show completed, collapsed groups), persisted per
// device via lib/viewPrefs like the other views' preferences.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { isOneOf, keepIf, stringArray, viewPrefs } from '@/lib/viewPrefs'
import { ZOOMS, type Zoom } from './timelineGeometry'
import type { GroupBy } from './timelineRows'

interface TimelineViewState {
  zoom: Zoom
  groupBy: GroupBy
  showCompleted: boolean
  collapsed: ReadonlySet<string>
  setZoom(zoom: Zoom): void
  setGroupBy(groupBy: GroupBy): void
  setShowCompleted(show: boolean): void
  toggleCollapsed(key: string): void
}

interface SavedTimelinePrefs {
  zoom: Zoom
  groupBy: GroupBy
  showCompleted: boolean
  collapsed: string[]
}

const isBool = (v: unknown): v is boolean => typeof v === 'boolean'

export const useTimelineViewStore = create<TimelineViewState>()(
  persist(
    (set) => ({
      zoom: 'day',
      groupBy: 'none',
      showCompleted: false,
      collapsed: new Set(),
      setZoom: (zoom) => set({ zoom }),
      setGroupBy: (groupBy) => set({ groupBy }),
      setShowCompleted: (showCompleted) => set({ showCompleted }),
      toggleCollapsed: (key) =>
        set((s) => {
          const next = new Set(s.collapsed)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return { collapsed: next }
        }),
    }),
    viewPrefs<TimelineViewState, SavedTimelinePrefs>(
      'timeline',
      (s) => ({
        zoom: s.zoom,
        groupBy: s.groupBy,
        showCompleted: s.showCompleted,
        collapsed: [...s.collapsed],
      }),
      (saved) => {
        const out: Partial<TimelineViewState> = {}
        keepIf(out, 'zoom', saved.zoom, isOneOf(ZOOMS))
        keepIf(out, 'groupBy', saved.groupBy, isOneOf<GroupBy>(['none', 'status', 'priority']))
        keepIf(out, 'showCompleted', saved.showCompleted, isBool)
        const collapsed = stringArray(saved.collapsed)
        if (collapsed) out.collapsed = new Set(collapsed)
        return out
      },
    ),
  ),
)
