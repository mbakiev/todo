// Session-only List view state (sort, grouping, status chips, collapsed groups). Kept in a
// tiny store so it survives switching views; not persisted (no Settings field for it).
import { create } from 'zustand'
import { STATUSES } from '@shared/constants'
import type { Status } from '@shared/types'
import type { ListGroupBy, ListSort } from './listModel'

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

export const useListViewStore = create<ListViewState>()((set) => ({
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
}))
