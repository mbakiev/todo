// Inline token parser for quick add (spec §8).
//   #word            → tag (created if new). Digits-only (`#1234`) is NOT a tag, nor is a
//                      word longer than the tag-name limit (it stays in the title).
//   !low !med !high !crit (also !medium !critical, !1–!4) → priority
//   @today @tomorrow @fri @nov20 @2026-12-01 … → due date; only consumed if it parses
//                      (a bare weekday is the next one strictly after today)
//                      as a date, so `@john` stays in the title.
// Tokens must start at the beginning of the input or after whitespace.

import * as chrono from 'chrono-node'
import { MAX_TAG_NAME_LENGTH, MAX_TITLE_LENGTH } from './constants'
import { addDays, isLocalDate, localDateToDate, presetDate, toLocalDate } from './dates'
import type { LocalDate, Priority, WeekStartsOn } from './types'

export type QuickAddToken =
  | { kind: 'tag'; start: number; end: number; raw: string; value: string }
  | { kind: 'priority'; start: number; end: number; raw: string; value: Priority }
  | { kind: 'due'; start: number; end: number; raw: string; value: LocalDate }

export interface QuickAddParseResult {
  /** Title with all recognised tokens removed and whitespace collapsed. */
  title: string
  /** Last priority token wins; null if none. */
  priority: Priority | null
  /** Last date token wins; null if none. */
  dueDate: LocalDate | null
  /** De-duplicated (case-insensitive) in first-seen order, without the `#`. */
  tagNames: string[]
  /** Every recognised token, in input order, with `[start, end)` ranges into the input. */
  tokens: QuickAddToken[]
}

export interface QuickAddParseOptions {
  /** Local date used to resolve relative dates. */
  today: LocalDate
  weekStartsOn?: WeekStartsOn
}

const PRIORITY_WORDS: Record<string, Priority> = {
  low: 1,
  '1': 1,
  med: 2,
  medium: 2,
  '2': 2,
  high: 3,
  '3': 3,
  crit: 4,
  critical: 4,
  '4': 4,
}

const WEEKDAYS: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
}

/** Trailing punctuation that may follow a token without being part of it. */
const TRAILING_PUNCT = /[.,;:!?)\]]+$/

// A whitespace-delimited chunk beginning with a token sigil.
const CANDIDATE_RE = /(^|\s)([#!@])(\S+)/gu
const TAG_BODY_RE = /^[\p{L}\p{N}_\-/]+$/u
const DIGITS_RE = /^\d+$/

/** Parses a date token body (without `@`). Returns null if it is not a date. */
export function parseDateToken(
  body: string,
  today: LocalDate,
  weekStartsOn: WeekStartsOn = 1,
): LocalDate | null {
  const word = body.toLowerCase()
  if (word === 'today' || word === 'tod') return today
  if (word === 'tomorrow' || word === 'tmr' || word === 'tom') return addDays(today, 1)
  if (word === 'nextweek' || word === 'next-week')
    return presetDate('nextWeek', today, weekStartsOn)
  if (isLocalDate(body)) return body

  const weekday = WEEKDAYS[word]
  if (weekday !== undefined) {
    // Next occurrence strictly after today: `@fri` on a Friday means next Friday
    // (`@today` exists for today).
    const todayDow = localDateToDate(today).getDay()
    return addDays(today, (weekday - todayDow + 7) % 7 || 7)
  }

  // Letters must contain at least one digit or a known date word for chrono to try;
  // this keeps names like `@john` or `@may` (ambiguous) out of the parser.
  if (!/\d/.test(word) && !word.startsWith('next')) return null

  // `nov20` → `nov 20`, `20nov` → `20 nov`, `next-fri` → `next fri`.
  const spaced = word
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .trim()
  const ref = localDateToDate(today)
  ref.setHours(12, 0, 0, 0)
  const results = chrono.parse(spaced, ref, { forwardDate: true })
  const first = results[0]
  if (!first || results.length !== 1) return null
  // The whole token must be the date; partial matches are not consumed.
  if (first.index !== 0 || first.text.length !== spaced.length) return null
  if (!first.start.isCertain('day') && !first.start.isCertain('weekday')) return null
  return toLocalDate(first.start.date())
}

export function parseQuickAdd(input: string, options: QuickAddParseOptions): QuickAddParseResult {
  const tokens: QuickAddToken[] = []
  const weekStartsOn = options.weekStartsOn ?? 1

  for (const m of input.matchAll(CANDIDATE_RE)) {
    const lead = m[1] ?? ''
    const sigil = m[2] ?? ''
    const chunk = m[3] ?? ''
    const body = chunk.replace(TRAILING_PUNCT, '')
    if (body === '') continue
    const start = (m.index ?? 0) + lead.length
    const end = start + 1 + body.length
    const raw = input.slice(start, end)

    if (sigil === '#') {
      // Over-long `#words` (pasted URLs fragments, hashes…) stay in the title: a tag that long
      // could not be created and would fail the whole save.
      if (!TAG_BODY_RE.test(body) || DIGITS_RE.test(body) || body.length > MAX_TAG_NAME_LENGTH)
        continue
      tokens.push({ kind: 'tag', start, end, raw, value: body })
    } else if (sigil === '!') {
      const p = PRIORITY_WORDS[body.toLowerCase()]
      if (p === undefined) continue
      tokens.push({ kind: 'priority', start, end, raw, value: p })
    } else {
      const date = parseDateToken(body, options.today, weekStartsOn)
      if (date === null) continue
      tokens.push({ kind: 'due', start, end, raw, value: date })
    }
  }

  let priority: Priority | null = null
  let dueDate: LocalDate | null = null
  const tagNames: string[] = []
  const seen = new Set<string>()
  for (const t of tokens) {
    if (t.kind === 'priority') priority = t.value
    else if (t.kind === 'due') dueDate = t.value
    else if (!seen.has(t.value.toLowerCase())) {
      seen.add(t.value.toLowerCase())
      tagNames.push(t.value)
    }
  }

  return { title: stripRanges(input, tokens), priority, dueDate, tagNames, tokens }
}

function stripRanges(input: string, ranges: ReadonlyArray<{ start: number; end: number }>): string {
  let out = ''
  let cursor = 0
  for (const r of ranges) {
    out += input.slice(cursor, r.start)
    cursor = r.end
  }
  out += input.slice(cursor)
  return out.replace(/\s+/g, ' ').trim()
}

/**
 * Removes one token from the raw input (for the chip "×" button), collapsing the
 * whitespace it leaves behind.
 */
export function removeToken(input: string, token: { start: number; end: number }): string {
  const before = input.slice(0, token.start)
  const after = input.slice(token.end)
  if (before.endsWith(' ') && (after.startsWith(' ') || after === '')) {
    return before.slice(0, -1) + after
  }
  if (before === '' && after.startsWith(' ')) return after.slice(1)
  return before + after
}

/**
 * Message when a cleaned title (tokens stripped) is too long to save, else null. Shown inline
 * by the quick-add form and the board's inline add, which disable saving meanwhile.
 */
export function titleLengthError(title: string): string | null {
  return title.length > MAX_TITLE_LENGTH
    ? `Title is too long: ${title.length.toLocaleString('en-US')} of ${MAX_TITLE_LENGTH} characters.`
    : null
}
