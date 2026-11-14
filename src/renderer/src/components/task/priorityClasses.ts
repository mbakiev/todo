import type { Priority } from '@shared/types'

/** Text-colour utility per priority (low slate, medium blue, high amber, critical red). */
export const PRIORITY_TEXT_CLASS: Record<Priority, string> = {
  1: 'text-priority-low',
  2: 'text-priority-medium',
  3: 'text-priority-high',
  4: 'text-priority-critical',
}

/** Background-colour utility per priority (solid). Use with an opacity modifier for soft fills. */
export const PRIORITY_BG_CLASS: Record<Priority, string> = {
  1: 'bg-priority-low',
  2: 'bg-priority-medium',
  3: 'bg-priority-high',
  4: 'bg-priority-critical',
}
