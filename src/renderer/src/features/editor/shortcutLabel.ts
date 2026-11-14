import { isMac } from '@/lib/platform'

/** "Mod-Shift-8" → "⌘⇧8" on macOS, "Ctrl+Shift+8" elsewhere. */
export function shortcutLabel(spec: string): string {
  const parts = spec.split('-')
  const key = (parts.pop() ?? '').toUpperCase()
  if (isMac()) {
    const symbols: Record<string, string> = { Mod: '⌘', Shift: '⇧', Alt: '⌥', Ctrl: '⌃' }
    return parts.map((p) => symbols[p] ?? p).join('') + key
  }
  const names: Record<string, string> = { Mod: 'Ctrl', Shift: 'Shift', Alt: 'Alt', Ctrl: 'Ctrl' }
  return [...parts.map((p) => names[p] ?? p), key].join('+')
}
