// Mechanism for views to render view-specific controls into the shell toolbar.
//
//   <ToolbarControls>
//     <SortSelect … />
//   </ToolbarControls>
//
// Render it anywhere inside your view; children are portalled into the toolbar slot and
// removed when the view unmounts.
import { useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ToolbarSlotContext } from './toolbarSlotContext'

export function ToolbarControls({ children }: { children: ReactNode }) {
  const slot = useContext(ToolbarSlotContext)
  if (!slot) return null
  return createPortal(children, slot)
}
