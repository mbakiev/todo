import { parseQuickAdd } from '@shared/quickAddParser'
import type { Tag } from '@shared/types'
import {
  buildCreateInput,
  initialDraft,
  removeTagToken,
  removeTokens,
  resolveDraft,
  type QuickAddDraft,
} from './quickAddModel'

const TODAY = '2026-11-13' // a Friday
const work: Tag = { id: 'w', name: 'Work', color: 'blue', createdAt: 1 }
const find = (name: string): Tag | undefined => (name.toLowerCase() === 'work' ? work : undefined)
const parse = (text: string) => parseQuickAdd(text, { today: TODAY, weekStartsOn: 1 })
const draft = (over: Partial<QuickAddDraft> = {}): QuickAddDraft => ({ ...initialDraft(), ...over })

describe('resolveDraft', () => {
  it('flags a cleaned title over 500 characters (tokens do not count) and blocks saving', () => {
    const ok = `${'a'.repeat(500)} #work !high @tomorrow`
    const okR = resolveDraft(draft({ text: ok }), parse(ok), {}, find)
    expect(okR).toMatchObject({ titleTooLong: false, error: null })
    const long = `${'a'.repeat(501)} #work`
    const r = resolveDraft(draft({ text: long }), parse(long), {}, find)
    expect(r.titleTooLong).toBe(true)
    expect(r.error).toBe('Title is too long: 501 of 500 characters.')
  })

  it('uses tokens, strips them from the title and splits existing / new tags', () => {
    const text = 'Call Anna #work #Home !high @tomorrow'
    const r = resolveDraft(draft({ text }), parse(text), {}, find)
    expect(r).toMatchObject({
      title: 'Call Anna',
      priority: 3,
      dueDate: '2026-11-14',
      startDate: null,
      status: 'not_started',
      tagIds: ['w'],
      newTagNames: ['Home'],
      error: null,
      overridden: { priority: false, due: false },
    })
  })

  it('explicit controls win over tokens, tokens win over prefill', () => {
    const text = 'x !high @tomorrow'
    const prefill = { priority: 1 as const, dueDate: '2026-12-01' }
    expect(resolveDraft(draft({ text }), parse(text), prefill, find)).toMatchObject({
      priority: 3,
      dueDate: '2026-11-14',
    })
    const explicit = draft({ text, explicitPriority: 4, explicitDue: null })
    expect(resolveDraft(explicit, parse(text), prefill, find)).toMatchObject({
      priority: 4,
      dueDate: null,
      overridden: { priority: true, due: true },
    })
  })

  it('falls back to prefill, then defaults', () => {
    const prefill = {
      dueDate: '2026-11-20',
      startDate: '2026-11-18',
      status: 'in_progress' as const,
    }
    expect(resolveDraft(draft({ text: 'x' }), parse('x'), prefill, find)).toMatchObject({
      priority: 2,
      dueDate: '2026-11-20',
      startDate: '2026-11-18',
      status: 'in_progress',
    })
  })

  it('merges picked tags with token tags without duplicates', () => {
    const r = resolveDraft(
      draft({ text: 'x #WORK', pickedTagIds: ['w', 'o'] }),
      parse('x #WORK'),
      {},
      find,
    )
    expect(r.tagIds).toEqual(['w', 'o'])
    expect(r.newTagNames).toEqual([])
  })

  it('reports an empty title and inverted dates', () => {
    expect(
      resolveDraft(draft({ text: '#work !high' }), parse('#work !high'), {}, find).error,
    ).toMatch(/title/)
    const inverted = draft({ text: 'x', explicitStart: '2026-11-20', explicitDue: '2026-11-19' })
    expect(resolveDraft(inverted, parse('x'), {}, find).error).toMatch(/start date/)
  })
})

describe('token removal', () => {
  it('removes a tag chip from the text so it is not parsed again', () => {
    const text = 'Plan #work offsite #work'
    const next = removeTagToken(text, parse(text), 'WORK')
    expect(next).toBe('Plan offsite')
    expect(parse(next).tagNames).toEqual([])
  })
  it('removes all tokens of a kind (e.g. when a control is set explicitly)', () => {
    const text = '!low Fix bug !high @fri'
    expect(removeTokens(text, parse(text), (t) => t.kind === 'priority')).toBe('Fix bug @fri')
  })
})

describe('buildCreateInput', () => {
  it('keeps Markdown but drops whitespace-only descriptions', () => {
    const r = resolveDraft(draft({ text: 'x' }), parse('x'), {}, find)
    expect(buildCreateInput(r, '  \n ').description).toBe('')
    expect(buildCreateInput(r, '- [ ] a\n- [ ] b\n\n').description).toBe('- [ ] a\n- [ ] b')
  })
})
