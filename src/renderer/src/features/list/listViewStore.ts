// List view preferences (sort, grouping, status chips, collapsed groups). Survive switching
// views and restarts: persisted per device via lib/viewPrefs (not Settings).
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { STATUSES } from '@shared/constants'
import type { Status } from '@shared/types'
import { isOneOf, keepIf, stringArray, viewPrefs } from '@/lib/viewPrefs'
import { LIST_COLUMN_IDS, type ListGroupBy, type ListSort } from './listModel'

interface ListViewState {
  sort: ListSort | null
  groupBy: ListGroupBy
  statuses: Status[]
  collapsed: ReadonlySet<string>
  setSort(sort: ListSort | null): void
  setGroupBy(groupBy: ListGroupBy): void
  toggleStatus(status: Status): void
  toggleCollapsed(key: string): void
}

interface SavedListPrefs {
  sort: ListSort | null
  groupBy: ListGroupBy
  statuses: Status[]
  collapsed: string[]
}

const isGroupBy = isOneOf<ListGroupBy>(['none', 'status', 'priority'])
const isColumn = isOneOf(LIST_COLUMN_IDS)
const isSort = (v: unknown): v is ListSort | null =>
  v === null ||
  (typeof v === 'object' &&
    isColumn((v as ListSort).id) &&
    typeof (v as ListSort).desc === 'boolean')
const isStatuses = (v: unknown): v is Status[] =>
  (stringArray(v) ?? null) !== null && (v as string[]).every(isOneOf(STATUSES))

export const useListViewStore = create<ListViewState>()(
  persist(
    (set) => ({
      sort: null,
      groupBy: 'none',
      statuses: [...STATUSES],
      collapsed: new Set(),
      setSort: (sort) => set({ sort }),
      setGroupBy: (groupBy) => set({ groupBy }),
      toggleStatus: (status) =>
        set((s) => ({
          statuses: s.statuses.includes(status)
            ? s.statuses.filter((x) => x !== status)
            : STATUSES.filter((x) => x === status || s.statuses.includes(x)),
        })),
      toggleCollapsed: (key) =>
        set((s) => {
          const next = new Set(s.collapsed)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return { collapsed: next }
        }),
    }),
    viewPrefs<ListViewState, SavedListPrefs>(
      'list',
      (s) => ({
        sort: s.sort,
        groupBy: s.groupBy,
        statuses: s.statuses,
        collapsed: [...s.collapsed],
      }),
      (saved) => {
        const out: Partial<ListViewState> = {}
        keepIf(out, 'sort', saved.sort, isSort)
        keepIf(out, 'groupBy', saved.groupBy, isGroupBy)
        keepIf(out, 'statuses', saved.statuses, isStatuses)
        const collapsed = stringArray(saved.collapsed)
        if (collapsed) out.collapsed = new Set(collapsed)
        return out
      },
    ),
  ),
)
