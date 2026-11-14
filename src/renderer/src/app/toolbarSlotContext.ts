import { createContext } from 'react'

/** DOM node in the toolbar that <ToolbarControls> portals into (provided by App). */
export const ToolbarSlotContext = createContext<HTMLElement | null>(null)
