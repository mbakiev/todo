import { toast } from 'sonner'
import { create } from 'zustand'
import type { DataChange, Tag, TagColor } from '@shared/types'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/errors'

// Optimistic tag edits use the same scheme as tasksStore: while an update is in flight the
// store keeps the newest server copy (`sync[id].base`) and replays pending patches on top, so
// a failure or a result for an earlier edit never reverts a concurrent edit.

interface TagOp {
  seq: number
  patch: { name?: string; color?: TagColor }
}

export interface TagsState {
  byId: Record<string, Tag>
  loaded: boolean
  /** Tags with an update in flight: newest server copy + pending patches. */
  sync: Record<string, { base: Tag; ops: TagOp[] }>
  load(): Promise<void>
  /** Creates a tag (not optimistic — the id comes from main). Null on error (toast shown). */
  create(name: string, color?: TagColor): Promise<Tag | null>
  update(id: string, patch: { name?: string; color?: TagColor }): Promise<Tag | null>
  remove(id: string): Promise<boolean>
  /** Finds a tag by name, case-insensitive. */
  findByName(name: string): Tag | undefined
  applyChange(change: DataChange): void
}

let nextSeq = 1

const replay = (base: Tag, ops: readonly TagOp[]): Tag =>
  ops.reduce<Tag>((t, op) => ({ ...t, ...op.patch }), base)

export const useTagsStore = create<TagsState>()((set, get) => ({
  byId: {},
  loaded: false,
  sync: {},

  async load() {
    const tags = await api().tags.list()
    const byId: Record<string, Tag> = {}
    for (const t of tags) byId[t.id] = t
    set({ byId, loaded: true })
  },

  async create(name, color) {
    try {
      const tag = await api().tags.create(color ? { name, color } : { name })
      set((s) => ({ byId: { ...s.byId, [tag.id]: tag } }))
      return tag
    } catch (err) {
      toast.error("Couldn't create tag", { description: errorMessage(err) })
      return null
    }
  },

  async update(id, patch) {
    const prev = get().byId[id]
    if (!prev) return null
    const op: TagOp = { seq: nextSeq++, patch }
    set((s) => {
      const cur = s.sync[id] ?? { base: prev, ops: [] }
      const entry = { base: cur.base, ops: [...cur.ops, op] }
      return {
        sync: { ...s.sync, [id]: entry },
        byId: { ...s.byId, [id]: replay(entry.base, entry.ops) },
      }
    })
    const settle = (server: Tag | null): void =>
      set((s) => {
        const cur = s.sync[id]
        if (!cur) return server ? { byId: { ...s.byId, [id]: server } } : s
        const base = server ?? cur.base
        const ops = cur.ops.filter((o) => o.seq !== op.seq)
        const sync = { ...s.sync }
        const byId = { ...s.byId }
        if (!(id in byId)) {
          // Deleted meanwhile (broadcast): nothing to show.
          delete sync[id]
          return { sync }
        }
        if (ops.length === 0) {
          delete sync[id]
          byId[id] = base
        } else {
          sync[id] = { base, ops }
          byId[id] = replay(base, ops)
        }
        return { sync, byId }
      })
    try {
      const tag = await api().tags.update(id, patch)
      settle(tag)
      return tag
    } catch (err) {
      settle(null)
      toast.error("Couldn't update tag", { description: errorMessage(err) })
      return null
    }
  },

  async remove(id) {
    try {
      await api().tags.delete(id)
      set((s) => {
        const byId = { ...s.byId }
        delete byId[id]
        return { byId }
      })
      return true
    } catch (err) {
      toast.error("Couldn't delete tag", { description: errorMessage(err) })
      return false
    }
  },

  findByName(name) {
    const n = name.trim().toLowerCase()
    return Object.values(get().byId).find((t) => t.name.toLowerCase() === n)
  },

  applyChange(change) {
    if (!change.tags?.length && !change.removedTagIds?.length) return
    set((s) => {
      const byId = { ...s.byId }
      let sync = s.sync
      for (const t of change.tags ?? []) {
        const entry = sync[t.id]
        if (entry) {
          sync = { ...sync, [t.id]: { base: t, ops: entry.ops } }
          byId[t.id] = replay(t, entry.ops)
        } else {
          byId[t.id] = t
        }
      }
      for (const id of change.removedTagIds ?? []) {
        delete byId[id]
        if (sync[id]) {
          sync = { ...sync }
          delete sync[id]
        }
      }
      return { byId, sync }
    })
  },
}))
