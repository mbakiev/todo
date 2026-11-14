import type { Tag } from '@shared/types'
import { taskToMarkdown } from './taskMarkdown'

const tags: Record<string, Tag> = {
  t1: { id: 't1', name: 'work', color: 'blue', createdAt: 0 },
  t2: { id: 't2', name: 'ops', color: 'orange', createdAt: 0 },
}

describe('taskToMarkdown', () => {
  it('renders title, metadata line and description', () => {
    expect(
      taskToMarkdown(
        {
          title: 'Ship the release',
          description: '- [ ] tag build\n- [x] notes\n',
          status: 'in_progress',
          priority: 3,
          startDate: '2026-11-10',
          dueDate: '2026-11-14',
          tagIds: ['t1', 't2', 'gone'],
        },
        tags,
      ),
    ).toBe(
      '# Ship the release\n\n' +
        '**Status:** In Progress · **Priority:** High · **Start:** 2026-11-10 · **Due:** 2026-11-14 · **Tags:** #work #ops\n\n' +
        '- [ ] tag build\n- [x] notes\n',
    )
  })

  it('omits empty parts and escapes the title', () => {
    expect(
      taskToMarkdown(
        {
          title: 'Fix *all* the [bugs] #1',
          description: '  ',
          status: 'not_started',
          priority: 2,
          startDate: null,
          dueDate: null,
          tagIds: [],
        },
        tags,
      ),
    ).toBe('# Fix \\*all\\* the \\[bugs\\] #1\n\n**Status:** Not Started · **Priority:** Medium\n')
  })
})
