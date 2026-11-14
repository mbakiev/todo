// zod schemas for every IPC payload and for the export/import file.

import { z } from 'zod'
import {
  EXPORT_APP_ID,
  EXPORT_FORMAT_VERSION,
  MAX_DESCRIPTION_LENGTH,
  MAX_TAG_NAME_LENGTH,
  MAX_TITLE_LENGTH,
  STATUSES,
  TAG_COLORS,
  VIEW_IDS,
} from './constants'
import { isLocalDate } from './dates'

export const idSchema = z.string().min(1).max(100)
export const statusSchema = z.enum(STATUSES)
export const prioritySchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
export const localDateSchema = z.string().refine(isLocalDate, 'Expected a YYYY-MM-DD date')
export const nullableLocalDateSchema = localDateSchema.nullable()
export const tagColorSchema = z.enum(TAG_COLORS)
export const tagNameSchema = z.string().trim().min(1).max(MAX_TAG_NAME_LENGTH)
const titleSchema = z.string().trim().min(1, 'Title is required').max(MAX_TITLE_LENGTH)
const descriptionSchema = z.string().max(MAX_DESCRIPTION_LENGTH)

function datesInOrder(v: { startDate?: string | null; dueDate?: string | null }): boolean {
  return !(v.startDate && v.dueDate && v.startDate > v.dueDate)
}
const DATE_ORDER_MSG = { message: 'Start date must not be after due date', path: ['startDate'] }

// --- tasks ------------------------------------------------------------------

export const taskCreateInputSchema = z
  .object({
    title: titleSchema,
    description: descriptionSchema.optional(),
    status: statusSchema.optional(),
    priority: prioritySchema.optional(),
    startDate: nullableLocalDateSchema.optional(),
    dueDate: nullableLocalDateSchema.optional(),
    tagIds: z.array(idSchema).max(100).optional(),
    newTagNames: z.array(tagNameSchema).max(50).optional(),
  })
  .strict()
  .refine(datesInOrder, DATE_ORDER_MSG)
export type TaskCreateInput = z.input<typeof taskCreateInputSchema>

// Date ordering against the *stored* task is checked in the repository.
export const taskUpdatePatchSchema = z
  .object({
    title: titleSchema.optional(),
    description: descriptionSchema.optional(),
    status: statusSchema.optional(),
    priority: prioritySchema.optional(),
    startDate: nullableLocalDateSchema.optional(),
    dueDate: nullableLocalDateSchema.optional(),
    position: z.number().finite().optional(),
    tagIds: z.array(idSchema).max(100).optional(),
  })
  .strict()
  .refine(datesInOrder, DATE_ORDER_MSG)
export type TaskUpdatePatch = z.input<typeof taskUpdatePatchSchema>

export const taskMoveInputSchema = z
  .object({
    /** Target column; omit to stay in the current one. */
    status: statusSchema.optional(),
    /** Task that will sit directly above (null = top of column). */
    beforeId: idSchema.nullable(),
    /** Task that will sit directly below (null = bottom of column). */
    afterId: idSchema.nullable(),
  })
  .strict()
export type TaskMoveInput = z.input<typeof taskMoveInputSchema>

// --- tags -------------------------------------------------------------------

export const tagCreateInputSchema = z
  .object({ name: tagNameSchema, color: tagColorSchema.optional() })
  .strict()
export type TagCreateInput = z.input<typeof tagCreateInputSchema>

export const tagUpdatePatchSchema = z
  .object({ name: tagNameSchema.optional(), color: tagColorSchema.optional() })
  .strict()
export type TagUpdatePatch = z.input<typeof tagUpdatePatchSchema>

// --- settings ---------------------------------------------------------------

const boardSortSchema = z.enum(['priority', 'due', 'manual'])
const windowBoundsSchema = z
  .object({
    x: z.number().int().optional(),
    y: z.number().int().optional(),
    width: z.number().int().min(200).max(20000),
    height: z.number().int().min(200).max(20000),
    isMaximized: z.boolean().optional(),
  })
  .strict()

export const settingsSchema = z
  .object({
    theme: z.enum(['system', 'light', 'dark']),
    weekStartsOn: z.union([z.literal(0), z.literal(1)]),
    shortcuts: z.object({ toggleApp: z.string().max(100), quickAdd: z.string().max(100) }).strict(),
    launchAtLogin: z.boolean(),
    boardSort: z
      .object({ today: boardSortSchema, week: boardSortSchema, everything: boardSortSchema })
      .strict(),
    detailPanelWidth: z.number().int().min(200).max(4000),
    lastView: z.enum(VIEW_IDS),
    windowBounds: windowBoundsSchema.nullable(),
  })
  .strict()

export const settingsPatchSchema = z
  .object({
    theme: settingsSchema.shape.theme.optional(),
    weekStartsOn: settingsSchema.shape.weekStartsOn.optional(),
    shortcuts: settingsSchema.shape.shortcuts.partial().optional(),
    launchAtLogin: z.boolean().optional(),
    boardSort: settingsSchema.shape.boardSort.partial().optional(),
    detailPanelWidth: settingsSchema.shape.detailPanelWidth.optional(),
    lastView: settingsSchema.shape.lastView.optional(),
    windowBounds: settingsSchema.shape.windowBounds.optional(),
  })
  .strict()
export type SettingsPatch = z.input<typeof settingsPatchSchema>
export type SettingsPatchParsed = z.output<typeof settingsPatchSchema>

// --- misc IPC args ----------------------------------------------------------

export const importModeSchema = z.enum(['merge', 'replace'])
export const quickAddHeightSchema = z.number().int().min(40).max(2000)
export const optionalTaskIdSchema = idSchema.optional()

// --- export file ------------------------------------------------------------

export const exportedTaskSchema = z
  .object({
    id: idSchema,
    title: z.string().max(MAX_TITLE_LENGTH),
    description: descriptionSchema,
    status: statusSchema,
    priority: prioritySchema,
    startDate: nullableLocalDateSchema,
    dueDate: nullableLocalDateSchema,
    position: z.number().finite(),
    tagIds: z.array(idSchema),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    completedAt: z.number().int().nonnegative().nullable(),
  })
  .refine(datesInOrder, DATE_ORDER_MSG)

export const exportedTagSchema = z.object({
  id: idSchema,
  name: tagNameSchema,
  color: tagColorSchema,
  createdAt: z.number().int().nonnegative(),
})

export const exportFileSchema = z.object({
  app: z.literal(EXPORT_APP_ID),
  formatVersion: z.literal(EXPORT_FORMAT_VERSION),
  exportedAt: z.number().int().nonnegative(),
  tasks: z.array(exportedTaskSchema),
  tags: z.array(exportedTagSchema),
})
