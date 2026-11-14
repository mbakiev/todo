// Electron accelerator helpers for the global-shortcut recorder (renderer) and the
// registration logic (main). Pure TS — the platform is always passed in.
//
// Stored format: Electron accelerator strings with explicit modifiers, e.g.
// `Alt+Shift+T`, `Command+Shift+K` (macOS), `Control+Alt+K` (Windows). Modifiers are
// written in a canonical order (Control, Alt, Shift, Command/Super) so two recordings of
// the same combo compare equal.

import type { Platform } from './types'

export type Modifier = 'Control' | 'Alt' | 'Shift' | 'Command' | 'Super'

const MODIFIER_ORDER: readonly Modifier[] = ['Control', 'Alt', 'Shift', 'Command', 'Super']

/** Aliases Electron accepts, mapped to our canonical modifier names. */
function modifierAlias(token: string, platform: Platform): Modifier | null {
  switch (token.toLowerCase()) {
    case 'control':
    case 'ctrl':
      return 'Control'
    case 'alt':
    case 'option':
    case 'altgr':
      return 'Alt'
    case 'shift':
      return 'Shift'
    case 'command':
    case 'cmd':
      return 'Command'
    case 'super':
    case 'meta':
      return platform === 'darwin' ? 'Command' : 'Super'
    case 'commandorcontrol':
    case 'cmdorctrl':
    case 'mod': // Tiptap / in-app spelling of the platform's primary modifier
      return platform === 'darwin' ? 'Command' : 'Control'
    default:
      return null
  }
}

const KEY_ALIASES: Record<string, string> = {
  enter: 'Return',
  return: 'Return',
  esc: 'Escape',
  escape: 'Escape',
  space: 'Space',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  plus: 'Plus',
}

/** Canonical key name, or the token upper-cased (letters) / as-is (punctuation). */
function canonicalKey(token: string): string {
  const alias = KEY_ALIASES[token.toLowerCase()]
  if (alias) return alias
  if (/^f\d{1,2}$/i.test(token)) return token.toUpperCase()
  if (/^num/i.test(token)) return token.toLowerCase()
  return token.length === 1 ? token.toUpperCase() : token
}

export interface ParsedAccelerator {
  modifiers: Modifier[]
  key: string
}

/** Splits an accelerator into canonical modifiers + key. Null if it has no key. */
export function parseAccelerator(accel: string, platform: Platform): ParsedAccelerator | null {
  const trimmed = accel.trim()
  if (trimmed === '') return null
  // `+` is a separator, but a trailing `+` (as in `Ctrl++`) is the plus key.
  const tokens = trimmed.endsWith('++')
    ? [...trimmed.slice(0, -2).split('+'), 'Plus']
    : trimmed.split('+')
  const mods = new Set<Modifier>()
  let key: string | null = null
  for (const raw of tokens) {
    const t = raw.trim()
    if (t === '') return null
    const mod = modifierAlias(t, platform)
    if (mod) mods.add(mod)
    else if (key === null) key = canonicalKey(t)
    else return null // two non-modifier keys
  }
  if (key === null) return null
  return { modifiers: MODIFIER_ORDER.filter((m) => mods.has(m)), key }
}

/** Canonical string for comparisons (e.g. collision checks). '' for empty/invalid. */
export function normalizeAccelerator(accel: string, platform: Platform): string {
  const p = parseAccelerator(accel, platform)
  return p ? [...p.modifiers, p.key].join('+') : ''
}

export function acceleratorsEqual(a: string, b: string, platform: Platform): boolean {
  const na = normalizeAccelerator(a, platform)
  return na !== '' && na === normalizeAccelerator(b, platform)
}

const MAC_SYMBOLS: Record<Modifier, string> = {
  Control: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Command: '⌘',
  Super: '⌘',
}
const WIN_LABELS: Record<Modifier, string> = {
  Control: 'Ctrl',
  Alt: 'Alt',
  Shift: 'Shift',
  Command: 'Win',
  Super: 'Win',
}
const MAC_KEY_SYMBOLS: Record<string, string> = {
  // U+FE0E forces text presentation (otherwise the emoji font draws a blue box).
  Return: '↩\uFE0E',
  // Spelled out like the key caps: the ⎋ / ⇥ glyphs are unfamiliar to most people.
  Escape: 'Esc',
  Space: 'Space',
  Tab: 'Tab',
  Backspace: '⌫',
  Delete: '⌦',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  Plus: '+',
}
const WIN_KEY_LABELS: Record<string, string> = {
  Return: 'Enter',
  Escape: 'Esc',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  Plus: '+',
}

/** Display label of one modifier: `⌃ ⌥ ⇧ ⌘` on macOS, `Ctrl Alt Shift Win` elsewhere. */
export function modifierLabel(m: Modifier, platform: Platform): string {
  return platform === 'darwin' ? MAC_SYMBOLS[m] : WIN_LABELS[m]
}

/**
 * Display parts for an accelerator, one per key cap: macOS uses ⌃⌥⇧⌘ symbols in Apple's
 * order, Windows uses `Ctrl`, `Alt`, `Shift`, `Win` (same order). Empty array for
 * empty/invalid input. The renderer reaches this only through `lib/shortcuts.ts`.
 */
export function acceleratorParts(accel: string, platform: Platform): string[] {
  const p = parseAccelerator(accel, platform)
  if (!p) return []
  const mac = platform === 'darwin'
  const mods = p.modifiers.map((m) => modifierLabel(m, platform))
  const key = (mac ? MAC_KEY_SYMBOLS[p.key] : WIN_KEY_LABELS[p.key]) ?? p.key
  return [...mods, key]
}

/** Single display string: `⌥⇧T` on macOS, `Alt+Shift+T` on Windows. */
export function formatAccelerator(accel: string, platform: Platform): string {
  const parts = acceleratorParts(accel, platform)
  return platform === 'darwin' ? parts.join('') : parts.join('+')
}

/** Subset of KeyboardEvent the recorder needs (keeps this file DOM-free). */
export interface KeyLike {
  key: string
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

export type RecordResult =
  /** Only modifiers held so far — keep listening. */
  | { kind: 'pending'; modifiers: Modifier[] }
  /** Esc without modifiers. */
  | { kind: 'cancel' }
  | { kind: 'invalid'; reason: 'needs-modifier' | 'unsupported-key' }
  | { kind: 'done'; accelerator: string }

const CODE_KEYS: Record<string, string> = {
  Space: 'Space',
  Enter: 'Return',
  NumpadEnter: 'Return',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
  NumpadDecimal: 'numdec',
}

const MODIFIER_CODES = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'OSLeft',
  'OSRight',
])

/**
 * Key from the physical `code`, so Option/Alt-modified characters (`⌥T` → `†`) and
 * keyboard layouts don't change what is recorded.
 */
function keyFromCode(code: string): string | null {
  let m = /^Key([A-Z])$/.exec(code)
  if (m) return m[1] ?? null
  m = /^Digit(\d)$/.exec(code)
  if (m) return m[1] ?? null
  m = /^Numpad(\d)$/.exec(code)
  if (m) return `num${m[1] ?? ''}`
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code
  return CODE_KEYS[code] ?? null
}

/** Interprets one keydown while recording a global shortcut. */
export function recordFromKeyEvent(e: KeyLike, platform: Platform): RecordResult {
  const mac = platform === 'darwin'
  const mods: Modifier[] = []
  if (e.ctrlKey) mods.push('Control')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (e.metaKey) mods.push(mac ? 'Command' : 'Super')

  if (MODIFIER_CODES.has(e.code) || ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) {
    return { kind: 'pending', modifiers: mods }
  }
  if ((e.code === 'Escape' || e.key === 'Escape') && mods.length === 0) return { kind: 'cancel' }

  const key = keyFromCode(e.code)
  if (!key) return { kind: 'invalid', reason: 'unsupported-key' }
  // At least one "real" modifier; Shift alone would hijack normal typing.
  if (!mods.some((m) => m !== 'Shift')) return { kind: 'invalid', reason: 'needs-modifier' }
  return { kind: 'done', accelerator: [...mods, key].join('+') }
}
