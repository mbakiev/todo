// Pure state model behind QuickAddForm (unit-tested in quickAddModel.test.ts).
//
// Precedence for each field: explicitly set control > inline token > prefill > default.
// The form shows each value once: priority and due date in their controls (which display the
// parsed token value), tags as removable chips. Setting a control explicitly strips the tokens
// of that kind from the title so they cannot be re-parsed; removing a tag chip removes its
// token text. A token typed *after* a control was set is reported in `overridden` (the
// control still wins).
import { DEFAULT_PRIORITY } from '@shared/constants'
import type { CreateTaskInput } from '@shared/ipc'
import {
  removeToken,
  titleLengthError,
  type QuickAddParseResult,
  type QuickAddToken,
} from '@shared/quickAddParser'
import type { LocalDate, Priority, Status, Tag } from '@shared/types'
import type { NewTaskPrefill } from '@/stores/uiStore'

export interface QuickAddDraft {
  /** Raw title text, including inline tokens. */
  text: string
  description: string
  /** null = not set explicitly. */
  explicitPriority: Priority | null
  /** undefined = not set explicitly; null = explicitly cleared. */
  explicitDue: LocalDate | null | undefined
  explicitStart: LocalDate | null | undefined
  /** Tags chosen with the tag picker (starts with the prefill's tags). */
  pickedTagIds: string[]
}

export function initialDraft(prefill: NewTaskPrefill = {}): QuickAddDraft {
  return {
    text: '',
    description: '',
    explicitPriority: null,
    explicitDue: undefined,
    explicitStart: undefined,
    pickedTagIds: [...(prefill.tagIds ?? [])],
  }
}

export interface TokenTag {
  name: string
  /** Existing tag with that name (case-insensitive); undefined → created on save. */
  tag: Tag | undefined
}

export interface ResolvedDraft {
  title: string
  status: Status
  priority: Priority
  dueDate: LocalDate | null
  startDate: LocalDate | null
  /** Existing tags: picked + token tags that already exist. */
  tagIds: string[]
  /** Token tags that do not exist yet (created on save). */
  newTagNames: string[]
  tokenTags: TokenTag[]
  /** A token of this kind is present but an explicit control wins. */
  overridden: { priority: boolean; due: boolean }
  /** Validation message, or null when the draft can be saved. */
  error: string | null
  /** The title is over the length limit (shown inline; saving is disabled). */
  titleTooLong: boolean
}

export function resolveDraft(
  draft: QuickAddDraft,
  parsed: QuickAddParseResult,
  prefill: NewTaskPrefill,
  findTagByName: (name: string) => Tag | undefined,
): ResolvedDraft {
  const priority = draft.explicitPriority ?? parsed.priority ?? prefill.priority ?? DEFAULT_PRIORITY
  const dueDate =
    draft.explicitDue !== undefined
      ? draft.explicitDue
      : (parsed.dueDate ?? prefill.dueDate ?? null)
  const startDate =
    draft.explicitStart !== undefined ? draft.explicitStart : (prefill.startDate ?? null)

  const tokenTags = parsed.tagNames.map((name) => ({ name, tag: findTagByName(name) }))
  const tagIds = [...draft.pickedTagIds]
  for (const t of tokenTags) if (t.tag && !tagIds.includes(t.tag.id)) tagIds.push(t.tag.id)
  const newTagNames = tokenTags.filter((t) => !t.tag).map((t) => t.name)

  let error: string | null = null
  if (parsed.title === '') error = 'Type a title'
  else if (titleLengthError(parsed.title)) error = titleLengthError(parsed.title)
  else if (startDate && dueDate && startDate > dueDate)
    error = 'The start date must be on or before the due date'

  return {
    title: parsed.title,
    status: prefill.status ?? 'not_started',
    priority,
    dueDate,
    startDate,
    tagIds,
    newTagNames,
    tokenTags,
    overridden: {
      priority: draft.explicitPriority !== null && parsed.priority !== null,
      due: draft.explicitDue !== undefined && parsed.dueDate !== null,
    },
    error,
    titleTooLong: titleLengthError(parsed.title) !== null,
  }
}

export function buildCreateInput(resolved: ResolvedDraft, description: string): CreateTaskInput {
  return {
    title: resolved.title,
    description: description.trim() === '' ? '' : description.replace(/\s+$/, ''),
    status: resolved.status,
    priority: resolved.priority,
    startDate: resolved.startDate,
    dueDate: resolved.dueDate,
    tagIds: resolved.tagIds,
    newTagNames: resolved.newTagNames,
  }
}

/** Removes every token matching `pred` from the raw text (right to left, so ranges stay valid). */
export function removeTokens(
  text: string,
  parsed: QuickAddParseResult,
  pred: (t: QuickAddToken) => boolean,
): string {
  let out = text
  const matching = parsed.tokens.filter(pred).sort((a, b) => b.start - a.start)
  for (const t of matching) out = removeToken(out, t)
  return out
}

/** Removes all tag tokens with this name (case-insensitive). */
export function removeTagToken(text: string, parsed: QuickAddParseResult, name: string): string {
  const n = name.toLowerCase()
  return removeTokens(text, parsed, (t) => t.kind === 'tag' && t.value.toLowerCase() === n)
}
