// "Copy as Markdown": `# Title`, one metadata line, then the description.
import { PRIORITY_LABELS, STATUS_LABELS } from '@shared/constants'
import type { Tag, Task } from '@shared/types'

type TaskFields = Pick<
  Task,
  'title' | 'description' | 'status' | 'priority' | 'startDate' | 'dueDate' | 'tagIds'
>

/** Escapes a title so it stays a single, literal heading line. */
function headingText(title: string): string {
  return title
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/([\\`*_[\]<])/g, '\\$1')
    .replace(/#+$/, (m) => `\\${m}`)
}

export function taskToMarkdown(task: TaskFields, tagsById: Record<string, Tag>): string {
  const meta = [
    `**Status:** ${STATUS_LABELS[task.status]}`,
    `**Priority:** ${PRIORITY_LABELS[task.priority]}`,
  ]
  if (task.startDate) meta.push(`**Start:** ${task.startDate}`)
  if (task.dueDate) meta.push(`**Due:** ${task.dueDate}`)
  const tags = task.tagIds.map((id) => tagsById[id]?.name).filter((n) => n !== undefined)
  if (tags.length) meta.push(`**Tags:** ${tags.map((n) => `#${n}`).join(' ')}`)

  const parts = [`# ${headingText(task.title)}`, meta.join(' · ')]
  const description = task.description.trim()
  if (description) parts.push(description)
  return `${parts.join('\n\n')}\n`
}
