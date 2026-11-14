import { toast } from 'sonner'
import { create } from 'zustand'
import type { DataChange, Tag, TagColor } from '@shared/types'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/errors'

export interface TagsState {
  byId: Record<string, Tag>
  loaded: boolean
  load(): Promise<void>
  /** Creates a tag (not optimistic — the id comes from main). Null on error (toast shown). */
  create(name: string, color?: TagColor): Promise<Tag | null>
  update(id: string, patch: { name?: string; color?: TagColor }): Promise<Tag | null>
  remove(id: string): Promise<boolean>
  /** Finds a tag by name, case-insensitive. */
  findByName(name: string): Tag | undefined
  applyChange(change: DataChange): void
}

export const useTagsStore = create<TagsState>()((set, get) => ({
  byId: {},
  loaded: false,

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
    set((s) => ({ byId: { ...s.byId, [id]: { ...prev, ...patch } } }))
    try {
      const tag = await api().tags.update(id, patch)
      set((s) => ({ byId: { ...s.byId, [id]: tag } }))
      return tag
    } catch (err) {
      set((s) => ({ byId: { ...s.byId, [id]: prev } }))
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
      for (const t of change.tags ?? []) byId[t.id] = t
      for (const id of change.removedTagIds ?? []) delete byId[id]
      return { byId }
    })
  },
}))
