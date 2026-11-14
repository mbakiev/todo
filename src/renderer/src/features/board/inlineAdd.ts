// Turns the board's inline "+ Add task" text into a create input, honouring the quick-add
// inline tokens (`#tag !high @fri`). Pure; unit-tested.

import { DEFAULT_PRIORITY } from '@shared/constants'
import type { CreateTaskInput } from '@shared/ipc'
import { parseQuickAdd } from '@shared/quickAddParser'
import type { LocalDate, Tag, WeekStartsOn } from '@shared/types'

export function buildInlineCreateInput(
  text: string,
  options: {
    today: LocalDate
    weekStartsOn: WeekStartsOn
    findTagByName(name: string): Pick<Tag, 'id'> | undefined
  },
): CreateTaskInput | null {
  const parsed = parseQuickAdd(text, { today: options.today, weekStartsOn: options.weekStartsOn })
  if (!parsed.title) return null
  const tagIds: string[] = []
  const newTagNames: string[] = []
  for (const name of parsed.tagNames) {
    const tag = options.findTagByName(name)
    if (tag) tagIds.push(tag.id)
    else newTagNames.push(name)
  }
  return {
    title: parsed.title,
    status: 'not_started',
    priority: parsed.priority ?? DEFAULT_PRIORITY,
    dueDate: parsed.dueDate,
    tagIds,
    newTagNames,
  }
}
