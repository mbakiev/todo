import {
  acceleratorParts,
  acceleratorsEqual,
  formatAccelerator,
  normalizeAccelerator,
  parseAccelerator,
  recordFromKeyEvent,
  type KeyLike,
} from './accelerators'

const key = (code: string, mods: Partial<KeyLike> = {}, k = ''): KeyLike => ({
  key: k || code.replace(/^Key|^Digit/, ''),
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
})

describe('parseAccelerator / normalizeAccelerator', () => {
  it('canonicalises modifier aliases and order', () => {
    expect(normalizeAccelerator('Shift+Alt+t', 'darwin')).toBe('Alt+Shift+T')
    expect(normalizeAccelerator('CmdOrCtrl+Shift+K', 'darwin')).toBe('Shift+Command+K')
    expect(normalizeAccelerator('CmdOrCtrl+Shift+K', 'win32')).toBe('Control+Shift+K')
    expect(normalizeAccelerator('Ctrl+Option+Space', 'darwin')).toBe('Control+Alt+Space')
    expect(normalizeAccelerator('Super+enter', 'win32')).toBe('Super+Return')
    expect(normalizeAccelerator('Ctrl++', 'win32')).toBe('Control+Plus')
  })
  it('rejects empty or malformed accelerators', () => {
    expect(parseAccelerator('', 'darwin')).toBeNull()
    expect(parseAccelerator('Alt+Shift', 'darwin')).toBeNull()
    expect(parseAccelerator('Alt+A+B', 'darwin')).toBeNull()
    expect(normalizeAccelerator('Alt++Shift', 'darwin')).toBe('')
  })
  it('compares accelerators', () => {
    expect(acceleratorsEqual('Alt+Shift+N', 'shift+alt+n', 'win32')).toBe(true)
    expect(acceleratorsEqual('CmdOrCtrl+N', 'Command+N', 'darwin')).toBe(true)
    expect(acceleratorsEqual('CmdOrCtrl+N', 'Command+N', 'win32')).toBe(false)
    expect(acceleratorsEqual('', '', 'darwin')).toBe(false)
  })
})

describe('formatAccelerator', () => {
  it('uses symbols in Apple order on macOS', () => {
    expect(formatAccelerator('Shift+Alt+T', 'darwin')).toBe('⌥⇧T')
    expect(formatAccelerator('Command+Control+Space', 'darwin')).toBe('⌃⌘Space')
    expect(acceleratorParts('Command+Shift+Return', 'darwin')).toEqual(['⇧', '⌘', '↩\uFE0E'])
  })
  it('uses words on Windows', () => {
    expect(formatAccelerator('Alt+Shift+T', 'win32')).toBe('Alt+Shift+T')
    expect(formatAccelerator('Control+Super+Up', 'win32')).toBe('Ctrl+Win+↑')
    expect(formatAccelerator('', 'win32')).toBe('')
  })
})

describe('recordFromKeyEvent', () => {
  it('waits while only modifiers are held', () => {
    expect(recordFromKeyEvent(key('AltLeft', { altKey: true }, 'Alt'), 'darwin')).toEqual({
      kind: 'pending',
      modifiers: ['Alt'],
    })
  })
  it('records from the physical key code (Option-modified characters)', () => {
    const e = key('KeyT', { altKey: true, shiftKey: true }, 'ˇ')
    expect(recordFromKeyEvent(e, 'darwin')).toEqual({ kind: 'done', accelerator: 'Alt+Shift+T' })
  })
  it('maps meta to Command on macOS and Super on Windows', () => {
    const e = key('KeyK', { metaKey: true })
    expect(recordFromKeyEvent(e, 'darwin')).toEqual({ kind: 'done', accelerator: 'Command+K' })
    expect(recordFromKeyEvent(e, 'win32')).toEqual({ kind: 'done', accelerator: 'Super+K' })
  })
  it('requires a non-Shift modifier', () => {
    expect(recordFromKeyEvent(key('KeyA'), 'win32')).toEqual({
      kind: 'invalid',
      reason: 'needs-modifier',
    })
    expect(recordFromKeyEvent(key('KeyA', { shiftKey: true }), 'win32')).toEqual({
      kind: 'invalid',
      reason: 'needs-modifier',
    })
  })
  it('cancels on plain Esc and rejects unknown keys', () => {
    expect(recordFromKeyEvent(key('Escape', {}, 'Escape'), 'darwin')).toEqual({ kind: 'cancel' })
    expect(recordFromKeyEvent(key('IntlRo', { ctrlKey: true }, 'ro'), 'win32')).toEqual({
      kind: 'invalid',
      reason: 'unsupported-key',
    })
  })
  it('records punctuation, digits, arrows and function keys', () => {
    const ctrl = { ctrlKey: true }
    expect(recordFromKeyEvent(key('Digit1', ctrl), 'win32')).toMatchObject({
      accelerator: 'Control+1',
    })
    expect(recordFromKeyEvent(key('Comma', ctrl, ','), 'win32')).toMatchObject({
      accelerator: 'Control+,',
    })
    expect(recordFromKeyEvent(key('ArrowUp', ctrl, 'ArrowUp'), 'win32')).toMatchObject({
      accelerator: 'Control+Up',
    })
    expect(recordFromKeyEvent(key('F13', ctrl, 'F13'), 'win32')).toMatchObject({
      accelerator: 'Control+F13',
    })
  })
})
