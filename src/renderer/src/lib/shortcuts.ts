// The only place a keyboard shortcut becomes display text (menus, tooltips, dialog footers,
// Settings, the recorder, the quick-add hint bar). Accepts Electron accelerator syntax plus
// `Mod` for the platform's primary modifier (⌘ on macOS, Ctrl elsewhere), e.g.
// `Mod+Shift+Return`. Order: macOS `⌃ ⌥ ⇧ ⌘` then the key; Windows `Ctrl+Alt+Shift+Win+Key`.
import {
  acceleratorParts,
  formatAccelerator,
  modifierLabel,
  type Modifier,
} from '@shared/accelerators'
import { appInfo } from './platform'

/** `⇧⌘↩` on macOS, `Ctrl+Shift+Enter` on Windows. '' for an empty / invalid shortcut. */
export function formatShortcut(accelerator: string): string {
  return formatAccelerator(accelerator, appInfo().platform)
}

/** One entry per key cap, in display order (for `<KeyCombo>`). */
export function shortcutParts(accelerator: string): string[] {
  return acceleratorParts(accelerator, appInfo().platform)
}

/** Label of a single held modifier (shortcut recorder). */
export function formatModifier(m: Modifier): string {
  return modifierLabel(m, appInfo().platform)
}

/** Tiptap key spec (`Mod-Shift-s`) → display text, through the same formatter. */
export function formatEditorShortcut(spec: string): string {
  return formatShortcut(spec.split('-').join('+'))
}
