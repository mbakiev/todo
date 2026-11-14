import { afterEach, describe, expect, it } from 'vitest'
import {
  CLICK_SLOP_PX,
  isEmptySpace,
  isPlainPrimary,
  onScrollbar,
  overlayOpen,
  shouldDeselect,
  type ClickInfo,
  type PressRecord,
} from './emptySpace'

afterEach(() => {
  document.body.innerHTML = ''
})

/** Builds a view container from markup; returns it and a lookup by `id`. */
function mount(html: string): { view: HTMLElement; byId(id: string): HTMLElement } {
  document.body.innerHTML = `<div id="outside"></div><div id="view">${html}</div><div id="portal"><button id="portal-btn"></button></div>`
  const view = document.getElementById('view')
  if (!view) throw new Error('no view')
  return {
    view,
    byId(id) {
      const el = document.getElementById(id)
      if (!el) throw new Error(`no #${id}`)
      return el
    },
  }
}

describe('isEmptySpace', () => {
  it('accepts plain view background, columns, headers and group rows', () => {
    const { view, byId } = mount(`
      <section id="column"><header id="col-header"><span id="col-title">Not Started</span></header>
        <div id="column-body"><p id="empty-text">Nothing here</p></div></section>
      <div role="row" data-group="done" id="group-row"><button id="group-btn">Done</button></div>
    `)
    for (const id of [
      'column',
      'col-header',
      'col-title',
      'column-body',
      'empty-text',
      'group-row',
    ])
      expect(isEmptySpace(byId(id), view, 0, 0), id).toBe(true)
    expect(isEmptySpace(view, view, 0, 0)).toBe(true)
  })

  it('rejects tasks and anything inside them', () => {
    const { view, byId } = mount(`
      <div data-task-id="t1" id="card"><span id="card-title">A</span></div>
      <div data-row-id="t2" id="grid-row"><div id="bar"></div></div>
    `)
    for (const id of ['card', 'card-title', 'grid-row', 'bar'])
      expect(isEmptySpace(byId(id), view, 0, 0), id).toBe(false)
  })

  it('rejects interactive controls and opted-out regions', () => {
    const { view, byId } = mount(`
      <button id="btn"><svg id="icon"></svg></button>
      <a href="#x" id="link">x</a>
      <input id="input" /><textarea id="ta"></textarea><select id="sel"></select>
      <label id="label">L</label>
      <div contenteditable="true" id="ce"><p id="ce-p">x</p></div>
      <div role="button" id="role-btn"></div>
      <div role="separator" id="sep"></div>
      <div role="columnheader" id="colhead"><span id="colhead-pad"></span></div>
      <div role="menu" id="menu"><div id="menu-item"></div></div>
      <div role="dialog" id="dialog"></div>
      <div data-radix-popper-content-wrapper id="popper"><div id="tip"></div></div>
      <div data-no-deselect id="opt-out"><p id="opt-out-p">err</p></div>
    `)
    for (const id of [
      'btn',
      'icon',
      'link',
      'input',
      'ta',
      'sel',
      'label',
      'ce',
      'ce-p',
      'role-btn',
      'sep',
      'colhead',
      'colhead-pad',
      'menu-item',
      'dialog',
      'tip',
      'opt-out',
      'opt-out-p',
    ])
      expect(isEmptySpace(byId(id), view, 0, 0), id).toBe(false)
  })

  it('accepts contenteditable="false" as plain content', () => {
    const { view, byId } = mount(`<div contenteditable="false" id="ro"></div>`)
    expect(isEmptySpace(byId('ro'), view, 0, 0)).toBe(true)
  })

  it('rejects targets outside the view (portals, sidebar, panel) and non-elements', () => {
    const { view, byId } = mount('')
    expect(isEmptySpace(byId('outside'), view, 0, 0)).toBe(false)
    expect(isEmptySpace(byId('portal-btn'), view, 0, 0)).toBe(false)
    expect(isEmptySpace(byId('portal'), view, 0, 0)).toBe(false)
    expect(isEmptySpace(null, view, 0, 0)).toBe(false)
    expect(isEmptySpace(window, view, 0, 0)).toBe(false)
  })

  it('treats a text node by its parent element', () => {
    const { view, byId } = mount(`<p id="plain">text</p><button id="b">go</button>`)
    const plainText = byId('plain').firstChild
    const buttonText = byId('b').firstChild
    expect(isEmptySpace(plainText, view, 0, 0)).toBe(true)
    expect(isEmptySpace(buttonText, view, 0, 0)).toBe(false)
  })

  it('ignores markers above the view (they are not part of it)', () => {
    document.body.innerHTML = `<div data-no-deselect><div id="view"><p id="p"></p></div></div>`
    const view = document.getElementById('view')
    const p = document.getElementById('p')
    if (!view || !p) throw new Error('missing')
    expect(isEmptySpace(p, view, 0, 0)).toBe(true)
  })
})

describe('onScrollbar', () => {
  // 200×100 box at (10, 20), 1px border, 8px scrollbars → client area 190×90.
  const box = { left: 10, top: 20, clientLeft: 1, clientTop: 1, clientWidth: 190, clientHeight: 90 }

  it('is false inside the client area', () => {
    expect(onScrollbar(box, 11, 21)).toBe(false)
    expect(onScrollbar(box, 200, 110)).toBe(false)
  })

  it('is true on the vertical, horizontal scrollbar and the corner', () => {
    expect(onScrollbar(box, 205, 50)).toBe(true)
    expect(onScrollbar(box, 50, 115)).toBe(true)
    expect(onScrollbar(box, 205, 115)).toBe(true)
  })
})

describe('isPlainPrimary', () => {
  const plain = { button: 0, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }
  it('accepts only an unmodified primary button', () => {
    expect(isPlainPrimary(plain)).toBe(true)
    expect(isPlainPrimary({ ...plain, button: 1 })).toBe(false)
    expect(isPlainPrimary({ ...plain, button: 2 })).toBe(false)
    expect(isPlainPrimary({ ...plain, ctrlKey: true })).toBe(false)
    expect(isPlainPrimary({ ...plain, metaKey: true })).toBe(false)
    expect(isPlainPrimary({ ...plain, altKey: true })).toBe(false)
    expect(isPlainPrimary({ ...plain, shiftKey: true })).toBe(false)
  })
})

describe('overlayOpen', () => {
  it('sees menus, dialogs and listboxes but not tooltips', () => {
    expect(overlayOpen()).toBe(false)
    document.body.innerHTML = `<div data-radix-popper-content-wrapper><div role="tooltip"></div></div>`
    expect(overlayOpen()).toBe(false)
    for (const role of ['menu', 'dialog', 'listbox']) {
      document.body.innerHTML = `<div role="${role}"></div>`
      expect(overlayOpen(), role).toBe(true)
    }
  })
})

describe('shouldDeselect', () => {
  const press: PressRecord = { empty: true, x: 100, y: 100, maxTravel: 0 }
  const click: ClickInfo = {
    button: 0,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    x: 100,
    y: 100,
    detail: 1,
    empty: true,
  }

  it('closes on a still, plain single click on empty space with a task open', () => {
    expect(shouldDeselect(press, click, true)).toBe(true)
    expect(shouldDeselect({ ...press, maxTravel: 2 }, { ...click, x: 102 }, true)).toBe(true)
  })

  it('does nothing with no task open', () => {
    expect(shouldDeselect(press, click, false)).toBe(false)
  })

  it('needs both the press and the click on empty space', () => {
    expect(shouldDeselect(null, click, true)).toBe(false)
    expect(shouldDeselect({ ...press, empty: false }, click, true)).toBe(false) // drag ended here
    expect(shouldDeselect(press, { ...click, empty: false }, true)).toBe(false)
  })

  it('rejects gestures: travel while down, or press and release apart', () => {
    expect(shouldDeselect({ ...press, maxTravel: CLICK_SLOP_PX }, click, true)).toBe(false)
    // Dragged away and back: the end point matches, the travel does not.
    expect(shouldDeselect({ ...press, maxTravel: 80 }, click, true)).toBe(false)
    expect(shouldDeselect(press, { ...click, x: 100 + CLICK_SLOP_PX, y: 100 }, true)).toBe(false)
    expect(shouldDeselect(press, { ...click, x: 103, y: 103 }, true)).toBe(false)
  })

  it('rejects modified, non-primary, multi- and keyboard clicks', () => {
    expect(shouldDeselect(press, { ...click, metaKey: true }, true)).toBe(false)
    expect(shouldDeselect(press, { ...click, ctrlKey: true }, true)).toBe(false)
    expect(shouldDeselect(press, { ...click, shiftKey: true }, true)).toBe(false)
    expect(shouldDeselect(press, { ...click, button: 2 }, true)).toBe(false)
    expect(shouldDeselect(press, { ...click, detail: 2 }, true)).toBe(false)
    expect(shouldDeselect(press, { ...click, detail: 0 }, true)).toBe(false)
  })
})
