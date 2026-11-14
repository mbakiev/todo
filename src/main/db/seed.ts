// Demo data for development and QA screenshots. Dates are relative to "today" so the
// boards always look realistic. Dev-only: invoked with `npm run seed` (`--seed` flag).

import { addDays, startOfLocalDayMs, startOfWeek, todayLocal } from '@shared/dates'
import type { LocalDate, Priority, Status, TagColor } from '@shared/types'
import type { Repos } from './index'

const HOUR = 3_600_000
const DAY = 24 * HOUR

const TAGS: Array<{ name: string; color: TagColor }> = [
  { name: 'work', color: 'blue' },
  { name: 'home', color: 'green' },
  { name: 'meeting', color: 'violet' },
  { name: 'ops', color: 'orange' },
  { name: 'errand', color: 'amber' },
  { name: 'health', color: 'teal' },
  { name: 'urgent', color: 'red' },
  { name: 'reading', color: 'slate' },
]

const RICH_DESCRIPTION = `Follow-ups from the **Q4 planning** sync.

| Owner | Item | Due |
| --- | --- | --- |
| Anna | Budget draft | Fri |
| Martin | Hiring plan | Mon |
| Li | Vendor review | Next week |

- [x] Share notes in #planning
- [x] Book room for the follow-up
- [ ] Send hiring plan to Anna
- [ ] Confirm vendor shortlist

See [the planning doc](https://example.com/planning) for context.`

const CHECKLIST_DESCRIPTION = `Packing list:

- [x] Passport
- [x] Charger
- [ ] Adapter (UK)
- [ ] Rain jacket`

const NOTES_DESCRIPTION = `Steps to reproduce:

1. Open the dashboard
2. Switch to *weekly* view
3. Observe the totals are off by one day

\`\`\`
TypeError: Cannot read properties of undefined (reading 'total')
\`\`\`

> Probably a timezone issue in the aggregation job.`

interface SeedTask {
  title: string
  status?: Status
  priority?: Priority
  start?: number | null
  due?: number | null
  tags?: string[]
  description?: string
  /** Days ago the task was completed (fractional allowed); only for done tasks. */
  doneDaysAgo?: number
  /** Days ago the task was created. */
  createdDaysAgo?: number
}

export interface SeedOptions {
  /** Delete all existing tasks and tags first. */
  reset?: boolean
  today?: LocalDate
  now?: number
}

/** Seeds ~40 tasks. Returns the number of tasks created. */
export function seedDemoData(repos: Repos, options: SeedOptions = {}): number {
  const now = options.now ?? Date.now()
  const today = options.today ?? todayLocal(new Date(now))
  const d = (offset: number): LocalDate => addDays(today, offset)
  const weekStart = startOfWeek(today, repos.settings.get().weekStartsOn)
  const daysSinceWeekStart = Math.round(
    (startOfLocalDayMs(today) - startOfLocalDayMs(weekStart)) / DAY,
  )

  // Offsets are days relative to today; null = no date.
  const tasks: SeedTask[] = [
    // --- no dates
    { title: 'Reply to Anna about the offsite agenda', priority: 3, tags: ['work'] },
    {
      title: 'File a ticket for the flaky CI job',
      tags: ['work', 'ops'],
      description: NOTES_DESCRIPTION,
    },
    { title: 'Order new running shoes', priority: 1, tags: ['health', 'errand'] },
    { title: 'Read "Designing Data-Intensive Applications" ch. 5', priority: 1, tags: ['reading'] },
    { title: 'Look into standing desk options', priority: 1, tags: ['home'] },
    { title: 'Ask IT about VPN access for contractors', status: 'blocked', tags: ['work', 'ops'] },
    { title: 'Draft blog post on the migration', status: 'in_progress', tags: ['work'] },
    // --- overdue
    { title: 'Submit expense report', priority: 3, due: -3, tags: ['work', 'urgent'] },
    { title: 'Renew car insurance', priority: 4, due: -1, tags: ['home', 'urgent'] },
    {
      title: 'Send meeting notes from Tuesday sync',
      due: -2,
      tags: ['meeting'],
      status: 'in_progress',
    },
    { title: 'Call the plumber back', priority: 2, due: -6, tags: ['home'], status: 'blocked' },
    // --- due today
    {
      title: 'Prepare slides for the 3pm review',
      priority: 4,
      due: 0,
      tags: ['work', 'meeting'],
      status: 'in_progress',
    },
    { title: 'Pick up dry cleaning', priority: 1, due: 0, tags: ['errand'] },
    { title: 'Review PR #1234 from Li', priority: 3, due: 0, tags: ['work'] },
    {
      title: 'Q4 planning follow-ups',
      priority: 3,
      due: 0,
      tags: ['work', 'meeting'],
      description: RICH_DESCRIPTION,
    },
    // --- this week / soon
    { title: 'Book dentist appointment', due: 1, tags: ['health'] },
    { title: 'Prepare 1:1 notes for Friday', due: 2, tags: ['meeting'] },
    { title: 'Update the on-call runbook', priority: 3, start: 1, due: 3, tags: ['ops'] },
    { title: 'Buy birthday present for Sam', priority: 2, due: 4, tags: ['errand', 'home'] },
    {
      title: 'Pack for the London trip',
      due: 5,
      tags: ['home'],
      description: CHECKLIST_DESCRIPTION,
    },
    // --- started already, due later (multi-day ranges)
    {
      title: 'Migrate billing service to the new queue',
      priority: 4,
      start: -4,
      due: 6,
      tags: ['work', 'ops'],
      status: 'in_progress',
      description: NOTES_DESCRIPTION,
    },
    {
      title: 'Write performance self-review',
      priority: 3,
      start: -2,
      due: 9,
      tags: ['work'],
      status: 'in_progress',
    },
    // --- future (hidden on Today/Week)
    {
      title: 'Plan team offsite logistics',
      priority: 2,
      start: 8,
      due: 15,
      tags: ['work', 'meeting'],
    },
    { title: 'Quarterly security training', priority: 2, due: 12, tags: ['work'] },
    { title: 'Schedule annual checkup', priority: 1, start: 14, tags: ['health'] },
    { title: 'Tax documents: gather receipts', priority: 3, start: 20, due: 34, tags: ['home'] },
    { title: 'Prepare holiday party budget', priority: 2, due: 30, tags: ['work'] },
    {
      title: 'Conference talk proposal',
      priority: 3,
      start: 25,
      due: 40,
      tags: ['work', 'reading'],
    },
    { title: 'Renew passport', priority: 2, due: 45, tags: ['errand'] },
    {
      title: 'Kitchen renovation quotes',
      priority: 1,
      start: 35,
      due: 60,
      tags: ['home'],
      status: 'blocked',
    },
    // --- done today
    {
      title: 'Email landlord about the heating',
      status: 'done',
      tags: ['home'],
      due: 0,
      doneDaysAgo: 0,
    },
    {
      title: 'Approve design mockups',
      status: 'done',
      priority: 3,
      tags: ['work'],
      doneDaysAgo: 0,
    },
    {
      title: 'Stand-up: share blockers',
      status: 'done',
      priority: 1,
      tags: ['meeting'],
      doneDaysAgo: 0,
    },
    // --- done earlier this week (falls back to "today" when today is the first day of the week)
    {
      title: 'Fix typo in onboarding doc',
      status: 'done',
      priority: 1,
      tags: ['work'],
      doneDaysAgo: Math.min(1, daysSinceWeekStart),
    },
    {
      title: 'Restock coffee beans',
      status: 'done',
      tags: ['errand'],
      doneDaysAgo: Math.min(2, daysSinceWeekStart),
    },
    // --- done last week / last month
    {
      title: 'Ship v2.3 release notes',
      status: 'done',
      priority: 3,
      tags: ['work'],
      doneDaysAgo: daysSinceWeekStart + 2,
    },
    {
      title: 'Return library books',
      status: 'done',
      priority: 1,
      tags: ['reading', 'errand'],
      doneDaysAgo: daysSinceWeekStart + 4,
    },
    {
      title: 'Set up new laptop',
      status: 'done',
      priority: 2,
      tags: ['work', 'ops'],
      doneDaysAgo: 24,
      description: CHECKLIST_DESCRIPTION,
    },
    {
      title: 'Cancel unused streaming subscription',
      status: 'done',
      priority: 1,
      tags: ['home'],
      doneDaysAgo: 33,
    },
    { title: 'Flu shot', status: 'done', priority: 2, tags: ['health'], doneDaysAgo: 40, due: -40 },
  ]

  return repos.db.transaction(() => {
    if (options.reset) {
      repos.db.exec('DELETE FROM task_tags; DELETE FROM tasks; DELETE FROM tags;')
    }
    const tagIds = new Map<string, string>()
    for (const t of TAGS) {
      const existing = repos.tags.findByName(t.name)
      tagIds.set(t.name, (existing ?? repos.tags.create(t)).id)
    }

    // Create oldest first so newer tasks land on top of their columns.
    tasks.forEach((t, i) => {
      const { task } = repos.tasks.create({
        title: t.title,
        description: t.description ?? '',
        status: t.status ?? 'not_started',
        priority: t.priority ?? 2,
        startDate: t.start === undefined || t.start === null ? null : d(t.start),
        dueDate: t.due === undefined || t.due === null ? null : d(t.due),
        tagIds: (t.tags ?? []).map((n) => tagIds.get(n)).filter((x): x is string => !!x),
      })
      const createdDaysAgo = t.createdDaysAgo ?? Math.max(t.doneDaysAgo ?? 0, 1) + ((i * 7) % 11)
      const createdAt = now - createdDaysAgo * DAY - i * 60_000
      let completedAt: number | null = null
      if (t.status === 'done') {
        // Done "today" tasks get a time earlier today (never in the future).
        const startOfToday = startOfLocalDayMs(today)
        const daysAgo = t.doneDaysAgo ?? 0
        completedAt =
          daysAgo === 0
            ? Math.max(startOfToday, now - (i % 5) * HOUR - 15 * 60_000)
            : startOfLocalDayMs(addDays(today, -daysAgo)) + 10 * HOUR + (i % 6) * HOUR
      }
      repos.db.run(
        'UPDATE tasks SET created_at = ?, updated_at = ?, completed_at = ? WHERE id = ?',
        [createdAt, Math.max(createdAt, completedAt ?? createdAt), completedAt, task.id],
      )
    })
    return tasks.length
  })
}
