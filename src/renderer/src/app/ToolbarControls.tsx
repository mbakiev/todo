// Mechanism for views to render view-specific controls into the shell toolbar.
//
//   <ToolbarControls>
//     <SortSelect … />
//   </ToolbarControls>
//
// Render it anywhere inside your view; children are portalled into the toolbar slot and
// removed when the view unmounts.
//
// The toolbar is a CSS container named `toolbar` (Toolbar.tsx) and degrades with its width:
//   < 960px  secondary labels collapse to icon + tooltip (ToolbarButton, filters, New task)
//   < 700px  the view title hides; search collapses to an icon that expands on click / Cmd+F
//   < 520px  view controls move to a second toolbar row
// (Thresholds are set by the widest view controls, the timeline's.)
// Use ToolbarButton for icon+label buttons so they follow the same rules.
import { forwardRef, useContext, type ComponentProps, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { ToolbarSlotContext } from './toolbarSlotContext'

export function ToolbarControls({ children }: { children: ReactNode }) {
  const slot = useContext(ToolbarSlotContext)
  if (!slot) return null
  return createPortal(children, slot)
}

export interface ToolbarButtonProps extends Omit<ComponentProps<typeof Button>, 'children'> {
  icon: ReactNode
  label: ReactNode
  /** Tooltip text (defaults to the label); shown in every width tier. */
  hint?: ReactNode
  /** Highlighted "on" state (toggles, active filters). */
  active?: boolean
}

/**
 * Ghost icon + label button for the toolbar. Below 960px of toolbar width the label collapses
 * (kept for screen readers) and the tooltip carries it.
 */
export const ToolbarButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  function ToolbarButton({ icon, label, hint, active, className, ...props }, ref) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            ref={ref}
            variant="ghost"
            size="sm"
            className={cn(
              'app-no-drag h-7 gap-1.5 px-2 text-[13px] font-normal has-[>svg]:px-2',
              '@max-[960px]/toolbar:w-7 @max-[960px]/toolbar:gap-0 @max-[960px]/toolbar:px-0 @max-[960px]/toolbar:has-[>svg]:px-0',
              active && 'bg-selection text-primary hover:bg-selection hover:text-primary',
              className,
            )}
            {...props}
          >
            {icon}
            <span className="@max-[960px]/toolbar:sr-only">{label}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{hint ?? label}</TooltipContent>
      </Tooltip>
    )
  },
)

/** Segmented control look shared by every view (board sort, timeline zoom). */
export const SEGMENTED_CLASS = 'h-7 gap-0.5 rounded-md bg-muted p-0.5'
export const SEGMENT_CLASS =
  'h-6 min-w-0 rounded-[5px] px-2 text-xs font-normal text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:font-medium data-[state=on]:text-foreground data-[state=on]:shadow-xs'
