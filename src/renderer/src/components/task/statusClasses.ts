import type { Status } from '@shared/types'

export const STATUS_TEXT_CLASS: Record<Status, string> = {
  not_started: 'text-status-not-started',
  in_progress: 'text-status-in-progress',
  blocked: 'text-status-blocked',
  done: 'text-status-done',
}

export const STATUS_BG_CLASS: Record<Status, string> = {
  not_started: 'bg-status-not-started',
  in_progress: 'bg-status-in-progress',
  blocked: 'bg-status-blocked',
  done: 'bg-status-done',
}
