// One human sentence for a failed IPC validation (zod issue), so toasts never show a raw
// schema path like "Invalid input (0.newTagNames.0): Too big: expected string to have <=50
// characters". Used by main's IPC `handle()`; the renderer's `errorMessage()` shows it as is.

/** The parts of a zod issue we use (structural, so this file does not depend on zod). */
export interface ValidationIssueLike {
  code: string
  path: readonly PropertyKey[]
  message: string
  maximum?: number | bigint
  minimum?: number | bigint
  origin?: string
}

const FIELD_NAMES: Record<string, string> = {
  title: 'title',
  description: 'description',
  name: 'tag name',
  newTagNames: 'tag name',
  tagIds: 'tags',
  startDate: 'start date',
  dueDate: 'due date',
  priority: 'priority',
  status: 'status',
  position: 'position',
  color: 'colour',
  shortcuts: 'shortcut',
  toggleApp: 'shortcut',
  quickAdd: 'shortcut',
}

function fieldName(path: readonly PropertyKey[]): string | null {
  for (let i = path.length - 1; i >= 0; i--) {
    const seg = path[i]
    if (typeof seg === 'string' && FIELD_NAMES[seg]) return FIELD_NAMES[seg]
  }
  return null
}

const fmt = (n: number | bigint): string => Number(n).toLocaleString('en-US')

export function describeValidationIssue(issue: ValidationIssueLike | undefined): string {
  if (!issue) return "That change couldn't be saved because it is not valid."
  const field = fieldName(issue.path)
  const what = field ? `The ${field}` : 'A value'
  const isList = issue.origin === 'array' || issue.origin === 'set'
  if (issue.code === 'too_big' && issue.maximum !== undefined) {
    if (isList) return `Too many ${field ?? 'items'} (at most ${fmt(issue.maximum)}).`
    if (issue.origin === 'string') {
      return `${what} is too long (at most ${fmt(issue.maximum)} characters).`
    }
    return `${what} is too large.`
  }
  if (issue.code === 'too_small') {
    if (issue.origin === 'string' && Number(issue.minimum ?? 1) <= 1)
      return `${what} can't be empty.`
    return `${what} is too short.`
  }
  if (issue.code === 'custom' && issue.message && !/^Invalid/i.test(issue.message)) {
    // Our own refinements carry a readable message (e.g. "Start date must not be after due date").
    return issue.message.endsWith('.') ? issue.message : `${issue.message}.`
  }
  return `${what} is not valid.`
}
