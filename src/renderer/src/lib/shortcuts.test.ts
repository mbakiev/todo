import { setAppInfo } from './platform'
import { formatEditorShortcut, formatModifier, formatShortcut, shortcutParts } from './shortcuts'

const as = (platform: 'darwin' | 'win32'): void =>
  setAppInfo({ version: '0.0.0', platform, isDev: false })

describe('shortcut display (one formatter for every hint)', () => {
  it('macOS: ⌃ ⌥ ⇧ ⌘ then the key, for app, dialog and editor shortcuts alike', () => {
    as('darwin')
    expect(formatShortcut('Mod+Shift+Return')).toBe('⇧⌘↩︎')
    expect(shortcutParts('Mod+Shift+Return')).toEqual(['⇧', '⌘', '↩︎'])
    expect(formatShortcut('Mod+N')).toBe('⌘N')
    expect(formatShortcut('Escape')).toBe('Esc')
    expect(formatEditorShortcut('Mod-Shift-s')).toBe('⇧⌘S')
    expect(formatEditorShortcut('Mod-Alt-3')).toBe('⌥⌘3')
    expect(formatModifier('Alt')).toBe('⌥')
  })

  it('Windows: Ctrl+Alt+Shift+Win+Key', () => {
    as('win32')
    expect(formatShortcut('Mod+Shift+Return')).toBe('Ctrl+Shift+Enter')
    expect(formatShortcut('Mod+,')).toBe('Ctrl+,')
    expect(formatEditorShortcut('Mod-Alt-3')).toBe('Ctrl+Alt+3')
    expect(formatEditorShortcut('Mod-Shift-8')).toBe('Ctrl+Shift+8')
    expect(formatModifier('Command')).toBe('Win')
  })

  afterAll(() => as('darwin'))
})
