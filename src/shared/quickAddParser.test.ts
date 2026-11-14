import { parseDateToken, parseQuickAdd, removeToken } from './quickAddParser'

const today = '2026-11-13' // Friday
const parse = (s: string) => parseQuickAdd(s, { today, weekStartsOn: 1 })

describe('parseQuickAdd', () => {
  it('plain title passes through', () => {
    const r = parse('  Reply to   Anna ')
    expect(r).toMatchObject({
      title: 'Reply to Anna',
      priority: null,
      dueDate: null,
      tagNames: [],
      tokens: [],
    })
  })

  it('parses tags, priority and date together', () => {
    const r = parse('File ticket #ops #Work !high @tomorrow')
    expect(r.title).toBe('File ticket')
    expect(r.tagNames).toEqual(['ops', 'Work'])
    expect(r.priority).toBe(3)
    expect(r.dueDate).toBe('2026-11-14')
    expect(r.tokens.map((t) => t.kind)).toEqual(['tag', 'tag', 'priority', 'due'])
  })

  it('token ranges point at the raw text', () => {
    const input = 'Call #bank @fri'
    const r = parse(input)
    for (const t of r.tokens) expect(input.slice(t.start, t.end)).toBe(t.raw)
    expect(r.tokens[0]).toMatchObject({ raw: '#bank', start: 5, end: 10 })
  })

  it('digits-only #1234 is not a tag', () => {
    const r = parse('Fix bug #1234 #v2')
    expect(r.title).toBe('Fix bug #1234')
    expect(r.tagNames).toEqual(['v2'])
  })

  it('@john is not consumed', () => {
    const r = parse('Ask @john about @today')
    expect(r.title).toBe('Ask @john about')
    expect(r.dueDate).toBe(today)
  })

  it('@may (name-like month) is not consumed', () => {
    expect(parse('Ping @may').title).toBe('Ping @may')
  })

  it('tokens must follow whitespace', () => {
    const r = parse('email foo@today.com and C#sharp and wow!high')
    expect(r.tokens).toHaveLength(0)
    expect(r.title).toBe('email foo@today.com and C#sharp and wow!high')
  })

  it('priority aliases', () => {
    expect(parse('a !low').priority).toBe(1)
    expect(parse('a !med').priority).toBe(2)
    expect(parse('a !medium').priority).toBe(2)
    expect(parse('a !HIGH').priority).toBe(3)
    expect(parse('a !crit').priority).toBe(4)
    expect(parse('a !critical').priority).toBe(4)
    expect(parse('a !1').priority).toBe(1)
    expect(parse('a !4').priority).toBe(4)
    expect(parse('a !5').priority).toBeNull()
    expect(parse('a !urgent').title).toBe('a !urgent')
  })

  it('last priority/date wins; all tokens stripped', () => {
    const r = parse('x !low !high @today @tomorrow')
    expect(r.priority).toBe(3)
    expect(r.dueDate).toBe('2026-11-14')
    expect(r.title).toBe('x')
  })

  it('dedupes tags case-insensitively', () => {
    expect(parse('x #Work #work #WORK').tagNames).toEqual(['Work'])
  })

  it('strips trailing punctuation from tokens', () => {
    const r = parse('Plan offsite #team, then book @fri.')
    expect(r.tagNames).toEqual(['team'])
    expect(r.dueDate).toBe('2026-11-13')
    expect(r.title).toBe('Plan offsite , then book .')
  })

  it('unicode tags and hyphens', () => {
    expect(parse('x #café #follow-up').tagNames).toEqual(['café', 'follow-up'])
  })

  it('token-only input yields empty title', () => {
    expect(parse('#a !high').title).toBe('')
  })
})

describe('parseDateToken', () => {
  it('keywords', () => {
    expect(parseDateToken('today', today)).toBe('2026-11-13')
    expect(parseDateToken('Tomorrow', today)).toBe('2026-11-14')
    expect(parseDateToken('tmr', today)).toBe('2026-11-14')
    expect(parseDateToken('nextweek', today, 1)).toBe('2026-11-16')
  })
  it('weekdays: next occurrence, today counts', () => {
    expect(parseDateToken('fri', today)).toBe('2026-11-13')
    expect(parseDateToken('sat', today)).toBe('2026-11-14')
    expect(parseDateToken('monday', today)).toBe('2026-11-16')
    expect(parseDateToken('thu', today)).toBe('2026-11-19')
  })
  it('ISO dates', () => {
    expect(parseDateToken('2026-12-01', today)).toBe('2026-12-01')
    expect(parseDateToken('2026-02-30', today)).toBeNull()
  })
  it('month+day forms resolve forward', () => {
    expect(parseDateToken('nov20', today)).toBe('2026-11-20')
    expect(parseDateToken('20nov', today)).toBe('2026-11-20')
    expect(parseDateToken('dec1', today)).toBe('2026-12-01')
    expect(parseDateToken('Jan-5', today)).toBe('2027-01-05')
    // Already passed this year → next year.
    expect(parseDateToken('nov1', today)).toBe('2027-11-01')
  })
  it('non-dates', () => {
    for (const w of ['john', 'may', 'team', 'nov', 'abc123', 'x1']) {
      expect(parseDateToken(w, today)).toBeNull()
    }
  })
})

describe('removeToken', () => {
  it('removes a chip and its spacing', () => {
    const input = 'Call #bank @fri now'
    const r = parse(input)
    const tag = r.tokens[0]
    if (!tag) throw new Error('expected token')
    expect(removeToken(input, tag)).toBe('Call @fri now')
    const last = parse('Call #bank').tokens[0]
    if (!last) throw new Error('expected token')
    expect(removeToken('Call #bank', last)).toBe('Call')
    const first = parse('#bank Call').tokens[0]
    if (!first) throw new Error('expected token')
    expect(removeToken('#bank Call', first)).toBe('Call')
  })
})
