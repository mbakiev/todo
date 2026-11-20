import { defaultSettings, defaultShortcuts } from './constants'
import {
  exportFileSchema,
  settingsPatchSchema,
  settingsSchema,
  tagCreateInputSchema,
  taskCreateInputSchema,
  taskMoveInputSchema,
  taskUpdatePatchSchema,
} from './schemas'

describe('schemas', () => {
  it('task create: trims title, rejects empty/unknown keys/bad dates', () => {
    expect(taskCreateInputSchema.parse({ title: '  Hi ' }).title).toBe('Hi')
    expect(taskCreateInputSchema.safeParse({ title: '   ' }).success).toBe(false)
    expect(taskCreateInputSchema.safeParse({ title: 'x', bogus: 1 }).success).toBe(false)
    expect(taskCreateInputSchema.safeParse({ title: 'x', dueDate: '2026-02-30' }).success).toBe(
      false,
    )
    expect(taskCreateInputSchema.safeParse({ title: 'x', priority: 5 }).success).toBe(false)
    expect(taskCreateInputSchema.safeParse({ title: 'x', status: 'archived' }).success).toBe(false)
    expect(
      taskCreateInputSchema.safeParse({
        title: 'x',
        startDate: '2026-11-20',
        dueDate: '2026-11-19',
      }).success,
    ).toBe(false)
    expect(
      taskCreateInputSchema.safeParse({
        title: 'x',
        startDate: '2026-11-19',
        dueDate: '2026-11-19',
      }).success,
    ).toBe(true)
  })
  it('task update: partial, nullable dates', () => {
    expect(taskUpdatePatchSchema.parse({ dueDate: null })).toEqual({ dueDate: null })
    expect(taskUpdatePatchSchema.safeParse({ id: 'x' }).success).toBe(false)
    expect(taskUpdatePatchSchema.safeParse({ position: Number.NaN }).success).toBe(false)
  })
  it('task move', () => {
    expect(taskMoveInputSchema.safeParse({ beforeId: null, afterId: 'a' }).success).toBe(true)
    expect(taskMoveInputSchema.safeParse({ afterId: 'a' }).success).toBe(false)
  })
  it('tag create', () => {
    expect(tagCreateInputSchema.parse({ name: ' ops ' }).name).toBe('ops')
    expect(tagCreateInputSchema.safeParse({ name: 'x', color: 'pink' }).success).toBe(false)
  })
  it('settings: defaults are valid, patch is partial', () => {
    expect(settingsSchema.parse(defaultSettings('darwin'))).toEqual(defaultSettings('darwin'))
    expect(settingsPatchSchema.parse({ boardSort: { week: 'due' } })).toEqual({
      boardSort: { week: 'due' },
    })
    expect(settingsPatchSchema.safeParse({ weekStartsOn: 3 }).success).toBe(false)
  })
  it('export file', () => {
    const file = {
      app: 'martin-todos',
      formatVersion: 1,
      exportedAt: 1,
      tags: [{ id: 'g', name: 'ops', color: 'blue', createdAt: 1 }],
      tasks: [
        {
          id: 't',
          title: 'x',
          description: '',
          status: 'done',
          priority: 2,
          startDate: null,
          dueDate: '2026-11-13',
          position: 0,
          tagIds: ['g'],
          createdAt: 1,
          updatedAt: 1,
          completedAt: 2,
        },
      ],
    }
    expect(exportFileSchema.safeParse(file).success).toBe(true)
    expect(exportFileSchema.safeParse({ ...file, formatVersion: 2 }).success).toBe(false)
  })
  it('export file: task startedAt is optional and nullable (older files lack it)', () => {
    const task = {
      id: 't',
      title: 'x',
      description: '',
      status: 'done',
      priority: 2,
      startDate: null,
      dueDate: null,
      position: 0,
      tagIds: [],
      createdAt: 1,
      updatedAt: 1,
      completedAt: 2,
    }
    const file = (t: object) => ({
      app: 'martin-todos',
      formatVersion: 1,
      exportedAt: 1,
      tags: [],
      tasks: [t],
    })
    expect(exportFileSchema.safeParse(file(task)).success).toBe(true)
    expect(exportFileSchema.safeParse(file({ ...task, startedAt: null })).success).toBe(true)
    const parsed = exportFileSchema.safeParse(file({ ...task, startedAt: 1 }))
    expect(parsed.success && parsed.data.tasks[0]?.startedAt).toBe(1)
    expect(exportFileSchema.safeParse(file({ ...task, startedAt: -1 })).success).toBe(false)
    expect(exportFileSchema.safeParse(file({ ...task, startedAt: 'x' })).success).toBe(false)
  })
  it('task update patch does not accept startedAt (it is never user-edited)', () => {
    expect(taskUpdatePatchSchema.safeParse({ startedAt: 1 }).success).toBe(false)
  })
})

describe('defaultShortcuts', () => {
  it('macOS keeps ⌥⇧N / ⌥⇧T; Windows and Linux use Ctrl+Alt (no layout-switch clash)', () => {
    expect(defaultShortcuts('darwin')).toEqual({
      quickAdd: 'Alt+Shift+N',
      toggleApp: 'Alt+Shift+T',
    })
    expect(defaultShortcuts('win32')).toEqual({
      quickAdd: 'Control+Alt+N',
      toggleApp: 'Control+Alt+T',
    })
    expect(defaultShortcuts('linux')).toEqual(defaultShortcuts('win32'))
    for (const p of ['darwin', 'win32', 'linux'] as const) {
      expect(settingsSchema.parse(defaultSettings(p))).toEqual(defaultSettings(p))
      expect(defaultSettings(p).shortcuts).toEqual(defaultShortcuts(p))
    }
  })
})
