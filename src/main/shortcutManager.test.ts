import { vi } from 'vitest'
import { createShortcutManager, type ShortcutRegistrar } from './shortcutManager'

/** Mocked globalShortcut: records registrations, refuses combos in `taken`. */
function mockRegistrar(taken: string[] = []) {
  const active = new Map<string, () => void>()
  const registrar: ShortcutRegistrar = {
    register: vi.fn((accel: string, cb: () => void) => {
      if (accel.includes('Bogus')) throw new Error('conversion failure')
      if (taken.includes(accel)) return false
      active.set(accel, cb)
      return true
    }),
    unregister: vi.fn((accel: string) => {
      active.delete(accel)
    }),
  }
  return { registrar, active }
}

const actions = () => ({ toggleApp: vi.fn(), quickAdd: vi.fn() })

describe('createShortcutManager', () => {
  it('registers both shortcuts and wires the callbacks', () => {
    const { registrar, active } = mockRegistrar()
    const a = actions()
    const m = createShortcutManager(registrar, a, 'darwin')
    const status = m.apply({ toggleApp: 'Alt+Shift+T', quickAdd: 'Alt+Shift+N' })
    expect(status).toEqual({
      toggleApp: { accelerator: 'Alt+Shift+T', registered: true },
      quickAdd: { accelerator: 'Alt+Shift+N', registered: true },
    })
    active.get('Alt+Shift+N')?.()
    expect(a.quickAdd).toHaveBeenCalledTimes(1)
    expect(a.toggleApp).not.toHaveBeenCalled()
  })

  it('reports a combo owned by another app instead of failing silently', () => {
    const { registrar } = mockRegistrar(['Alt+Shift+N'])
    const status = createShortcutManager(registrar, actions(), 'win32').apply({
      toggleApp: 'Alt+Shift+T',
      quickAdd: 'Alt+Shift+N',
    })
    expect(status.toggleApp.registered).toBe(true)
    expect(status.quickAdd).toMatchObject({
      registered: false,
      error: expect.stringMatching(/in use/),
    })
  })

  it('detects collisions between the two shortcuts (alias-insensitive)', () => {
    const { registrar } = mockRegistrar()
    const status = createShortcutManager(registrar, actions(), 'darwin').apply({
      toggleApp: 'CmdOrCtrl+Shift+K',
      quickAdd: 'Shift+Command+K',
    })
    expect(status.toggleApp.registered).toBe(true)
    expect(status.quickAdd).toMatchObject({
      registered: false,
      error: expect.stringMatching(/Same shortcut/),
    })
    expect(registrar.register).toHaveBeenCalledTimes(1)
  })

  it('treats an empty accelerator as disabled and reports invalid ones', () => {
    const { registrar } = mockRegistrar()
    const status = createShortcutManager(registrar, actions(), 'win32').apply({
      toggleApp: '',
      quickAdd: 'Ctrl+Bogus',
    })
    expect(status.toggleApp).toEqual({ accelerator: '', registered: false })
    expect(status.quickAdd).toMatchObject({
      registered: false,
      error: expect.stringMatching(/Could not register/),
    })
  })

  it('unregisters the previous combos before re-registering', () => {
    const { registrar, active } = mockRegistrar()
    const m = createShortcutManager(registrar, actions(), 'darwin')
    m.apply({ toggleApp: 'Alt+Shift+T', quickAdd: 'Alt+Shift+N' })
    m.apply({ toggleApp: 'Alt+Shift+T', quickAdd: 'Control+Space' })
    expect([...active.keys()].sort()).toEqual(['Alt+Shift+T', 'Control+Space'])
    expect(registrar.unregister).toHaveBeenCalledWith('Alt+Shift+N')
  })

  it('suspends and resumes (for the shortcut recorder)', () => {
    const { registrar, active } = mockRegistrar()
    const m = createShortcutManager(registrar, actions(), 'darwin')
    m.apply({ toggleApp: 'Alt+Shift+T', quickAdd: 'Alt+Shift+N' })
    m.suspend()
    expect(active.size).toBe(0)
    // Changes while suspended are remembered but not registered.
    m.apply({ toggleApp: 'Alt+Shift+T', quickAdd: 'Alt+Shift+Q' })
    expect(active.size).toBe(0)
    const status = m.resume()
    expect([...active.keys()].sort()).toEqual(['Alt+Shift+Q', 'Alt+Shift+T'])
    expect(status.quickAdd).toEqual({ accelerator: 'Alt+Shift+Q', registered: true })
  })

  it('unregisterAll releases everything', () => {
    const { registrar, active } = mockRegistrar()
    const m = createShortcutManager(registrar, actions(), 'darwin')
    m.apply({ toggleApp: 'Alt+Shift+T', quickAdd: 'Alt+Shift+N' })
    m.unregisterAll()
    expect(active.size).toBe(0)
  })
})
