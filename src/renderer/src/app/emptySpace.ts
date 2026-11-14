// "Click on empty space closes the detail panel" (spec §7): the pure decisions behind
// `useEmptySpaceDeselect`. Kept free of React and of the stores so they can be unit-tested.

/**
 * Anything matching this (on the target or an ancestor inside the view) is not empty space:
 * tasks, interactive controls, and regions that opted out with `data-no-deselect`.
 */
export const NOT_EMPTY_SPACE_SELECTOR = [
  // Tasks: board cards, list rows, calendar chips/bars, timeline row labels (`data-task-id`)
  // and timeline grid rows, whose whole width selects the task (`data-row-id`).
  '[data-task-id]',
  '[data-row-id]',
  // Interactive elements.
  'a[href]',
  'button',
  'input',
  'textarea',
  'select',
  'label',
  'summary',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="slider"]',
  '[role="combobox"]',
  '[role="option"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="separator"]', // resize handles
  '[role="columnheader"]', // sortable / resizable table headers
  // Overlays (normally portalled out of the view anyway).
  '[role="dialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="tooltip"]',
  '[data-radix-popper-content-wrapper]',
  // Explicit opt-out for a feature region that must keep its clicks.
  '[data-no-deselect]',
].join(', ')

/**
 * True when an overlay that owns outside clicks is open (a menu, popover, select or dialog): the
 * click that dismisses it must not also close the panel — the same order Esc follows. Tooltips
 * do not count (they never consume a click).
 */
export function overlayOpen(doc: Document = document): boolean {
  return doc.querySelector('[role="dialog"], [role="menu"], [role="listbox"]') !== null
}

/** The box of an element, enough to tell whether a point is on its scrollbar. */
export interface ScrollBox {
  left: number
  top: number
  clientLeft: number
  clientTop: number
  clientWidth: number
  clientHeight: number
}

/**
 * True when (x, y) lies on the element's scrollbar (or its corner): inside the border box but
 * outside the client area. A scrollbar press targets the scrolling element itself.
 */
export function onScrollbar(box: ScrollBox, x: number, y: number): boolean {
  const innerX = x - box.left - box.clientLeft
  const innerY = y - box.top - box.clientTop
  return innerX >= box.clientWidth || innerY >= box.clientHeight
}

function scrollBoxOf(el: Element): ScrollBox {
  const r = el.getBoundingClientRect()
  return {
    left: r.left,
    top: r.top,
    clientLeft: el.clientLeft,
    clientTop: el.clientTop,
    clientWidth: el.clientWidth,
    clientHeight: el.clientHeight,
  }
}

/**
 * True when a pointer event at (x, y) on `target` hits empty space of `container` (the element
 * hosting the active view): inside it in the DOM (portals are not), not on a task, control,
 * overlay or opted-out region, and not on a scrollbar.
 */
export function isEmptySpace(
  target: EventTarget | null,
  container: Element,
  x: number,
  y: number,
): boolean {
  const el =
    target instanceof Element ? target : target instanceof Node ? target.parentElement : null
  if (!el || !container.contains(el)) return false
  const hit = el.closest(NOT_EMPTY_SPACE_SELECTOR)
  if (hit && container.contains(hit)) return false
  // Only a scrolling element can show a scrollbar; skip the layout read for the rest.
  const scrolls = el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth
  return !(scrolls && onScrollbar(scrollBoxOf(el), x, y))
}

/** Modifier and button state shared by pointer and mouse events. */
export interface ButtonState {
  button: number
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

/** A plain primary-button press: no right / middle button, no modifier (Ctrl+click = menu). */
export function isPlainPrimary(e: ButtonState): boolean {
  return e.button === 0 && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey
}

/** Pointer travel (CSS px) beyond which a press is a gesture (drag, selection), not a click. */
export const CLICK_SLOP_PX = 4

/** What was recorded at pointerdown for the press that ends in a click. */
export interface PressRecord {
  /** The press started on empty space, plain primary, with no overlay open. */
  empty: boolean
  x: number
  y: number
  /** Farthest the pointer travelled from (x, y) while the button was down. */
  maxTravel: number
}

export interface ClickInfo extends ButtonState {
  x: number
  y: number
  /**
   * `UIEvent.detail`: 1 for a single click, 2+ for the later clicks of a multi-click, 0 for a
   * click synthesised from the keyboard or by script.
   */
  detail: number
  /** The click itself landed on empty space. */
  empty: boolean
}

/** Distance between two points. */
export function travel(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1)
}

/**
 * The whole decision: a real single click whose press and release both landed on empty space
 * with no meaningful movement in between, and a task is open.
 */
export function shouldDeselect(
  press: PressRecord | null,
  click: ClickInfo,
  hasSelection: boolean,
): boolean {
  if (!hasSelection || !press?.empty || !click.empty) return false
  if (!isPlainPrimary(click) || click.detail !== 1) return false
  const moved = Math.max(press.maxTravel, travel(press.x, press.y, click.x, click.y))
  return moved < CLICK_SLOP_PX
}
