import { randomUUID } from 'node:crypto'
import { TAG_COLORS } from '@shared/constants'
import type { Tag, TagColor } from '@shared/types'
import type { Db } from './connection'
import { RepoError, notFound } from './errors'

interface TagRow {
  id: string
  name: string
  color: string
  created_at: number
}

function isTagColor(c: string): c is TagColor {
  return (TAG_COLORS as readonly string[]).includes(c)
}

function toTag(r: TagRow): Tag {
  return {
    id: r.id,
    name: r.name,
    color: isTagColor(r.color) ? r.color : 'slate',
    createdAt: r.created_at,
  }
}

export interface TagsRepo {
  list(): Tag[]
  get(id: string): Tag | undefined
  findByName(name: string): Tag | undefined
  create(input: { name: string; color?: TagColor }): Tag
  /** Returns the existing tag with this name (case-insensitive) or creates it. */
  ensureByName(name: string): { tag: Tag; created: boolean }
  update(id: string, patch: { name?: string; color?: TagColor }): Tag
  /** Hard delete. Returns ids of (non-deleted) tasks that carried the tag. */
  delete(id: string): { affectedTaskIds: string[] }
  /** Least-used palette colour (ties broken by palette order). */
  nextColor(): TagColor
}

export function createTagsRepo(db: Db, now: () => number = Date.now): TagsRepo {
  const repo: TagsRepo = {
    list() {
      return db.all<TagRow>('SELECT * FROM tags ORDER BY name COLLATE NOCASE').map(toTag)
    },

    get(id) {
      const r = db.get<TagRow>('SELECT * FROM tags WHERE id = ?', [id])
      return r ? toTag(r) : undefined
    },

    findByName(name) {
      const r = db.get<TagRow>('SELECT * FROM tags WHERE name = ? COLLATE NOCASE', [name.trim()])
      return r ? toTag(r) : undefined
    },

    nextColor() {
      const counts = new Map<string, number>(TAG_COLORS.map((c) => [c, 0]))
      for (const r of db.all<{ color: string; n: number }>(
        'SELECT color, COUNT(*) AS n FROM tags GROUP BY color',
      )) {
        if (counts.has(r.color)) counts.set(r.color, r.n)
      }
      let best: TagColor = TAG_COLORS[0]
      let bestN = Infinity
      for (const c of TAG_COLORS) {
        const n = counts.get(c) ?? 0
        if (n < bestN) {
          best = c
          bestN = n
        }
      }
      return best
    },

    create(input) {
      const name = input.name.trim()
      if (name === '') throw new RepoError('validation', 'Tag name is required')
      if (repo.findByName(name))
        throw new RepoError('conflict', `A tag named "${name}" already exists`)
      const tag: Tag = {
        id: randomUUID(),
        name,
        color: input.color ?? repo.nextColor(),
        createdAt: now(),
      }
      db.run('INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)', [
        tag.id,
        tag.name,
        tag.color,
        tag.createdAt,
      ])
      return tag
    },

    ensureByName(name) {
      const existing = repo.findByName(name)
      if (existing) return { tag: existing, created: false }
      return { tag: repo.create({ name }), created: true }
    },

    update(id, patch) {
      const existing = repo.get(id)
      if (!existing) throw notFound('Tag', id)
      const name = patch.name?.trim() ?? existing.name
      if (name === '') throw new RepoError('validation', 'Tag name is required')
      const clash = repo.findByName(name)
      if (clash && clash.id !== id)
        throw new RepoError('conflict', `A tag named "${name}" already exists`)
      const color = patch.color ?? existing.color
      db.run('UPDATE tags SET name = ?, color = ? WHERE id = ?', [name, color, id])
      return { ...existing, name, color }
    },

    delete(id) {
      return db.transaction(() => {
        if (!repo.get(id)) throw notFound('Tag', id)
        const affected = db
          .all<{ task_id: string }>(
            `SELECT tt.task_id FROM task_tags tt JOIN tasks t ON t.id = tt.task_id
             WHERE tt.tag_id = ? AND t.deleted_at IS NULL`,
            [id],
          )
          .map((r) => r.task_id)
        const ts = now()
        for (const taskId of affected) {
          db.run('UPDATE tasks SET updated_at = ? WHERE id = ?', [ts, taskId])
        }
        db.run('DELETE FROM tags WHERE id = ?', [id])
        return { affectedTaskIds: affected }
      })
    },
  }
  return repo
}
