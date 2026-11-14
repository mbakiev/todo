import type { ShortcutStatus } from '@shared/types'
import {
  failureKey,
  failureMessage,
  failuresToAnnounce,
  loadAnnounced,
  saveAnnounced,
} from './shortcutFailures'

const taken = 'Already in use by another app or by the system'
const status = (over: Partial<ShortcutStatus> = {}): ShortcutStatus => ({
  quickAdd: { accelerator: 'Alt+Shift+N', registered: false, error: taken },
  toggleApp: { accelerator: 'Alt+Shift+T', registered: true },
  ...over,
})

describe('global shortcut failure toast', () => {
  it('announces a failing shortcut once', () => {
    const first = failuresToAnnounce(status(), new Set())
    expect(first).toEqual([{ name: 'quickAdd', accelerator: 'Alt+Shift+N', error: taken }])
    const announced = new Set(first.map(failureKey))
    expect(failuresToAnnounce(status(), announced)).toEqual([])
  })

  it('never for a shortcut the user turned off, nor while it is suspended (no error)', () => {
    expect(
      failuresToAnnounce(
        status({
          quickAdd: { accelerator: '', registered: false },
          toggleApp: { accelerator: 'Alt+Shift+T', registered: false },
        }),
        new Set(),
      ),
    ).toEqual([])
  })

  it('re-evaluates when the combo changes: a new failing combo is announced again', () => {
    const announced = new Set(failuresToAnnounce(status(), new Set()).map(failureKey))
    const changed = status({
      quickAdd: { accelerator: 'Control+Alt+Q', registered: false, error: taken },
    })
    expect(failuresToAnnounce(changed, announced)).toHaveLength(1)
  })

  it('names the action, the combo and the reason', () => {
    const msg = failureMessage(failuresToAnnounce(status(), new Set()), () => '⌥⇧N')
    expect(msg.title).toBe("The Quick add shortcut ⌥⇧N isn't working")
    expect(msg.description).toContain(taken)
    const both = failureMessage(
      [
        { name: 'quickAdd', accelerator: 'a', error: 'x' },
        { name: 'toggleApp', accelerator: 'b', error: 'y' },
      ],
      (a) => a.toUpperCase(),
    )
    expect(both.title).toBe("2 global shortcuts aren't working")
    expect(both.description).toBe('Quick add (A): x. Show / hide window (B): y.')
  })

  it('remembers what was announced in session storage (survives a reload)', () => {
    saveAnnounced(sessionStorage, new Set(['k1']))
    expect([...loadAnnounced(sessionStorage)]).toEqual(['k1'])
    sessionStorage.setItem('martin-todos.announcedShortcutFailures', '{bad')
    expect(loadAnnounced(sessionStorage).size).toBe(0)
  })
})
