import type { BoardScope, Priority, Settings, Status, TagColor, ViewId } from './types'

export const APP_DISPLAY_NAME = "Martin's To Dos"
export const EXPORT_APP_ID = 'martin-todos'
export const EXPORT_FORMAT_VERSION = 1

export const STATUSES = [
  'not_started',
  'in_progress',
  'blocked',
  'done',
] as const satisfies readonly Status[]
export const OPEN_STATUSES: readonly Status[] = ['not_started', 'in_progress', 'blocked']

export const STATUS_LABELS: Record<Status, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  done: 'Done',
}

/** Highest first, as shown in pickers. */
export const PRIORITIES: readonly Priority[] = [4, 3, 2, 1]
export const DEFAULT_PRIORITY: Priority = 2

export const PRIORITY_LABELS: Record<Priority, string> = {
  1: 'Low',
  2: 'Medium',
  3: 'High',
  4: 'Critical',
}

/**
 * Priority colour keys (Tailwind palette names). The renderer maps these to CSS tokens
 * `--priority-low|medium|high|critical`; use those tokens rather than raw colours.
 */
export const PRIORITY_COLORS: Record<Priority, 'slate' | 'blue' | 'amber' | 'red'> = {
  1: 'slate',
  2: 'blue',
  3: 'amber',
  4: 'red',
}

export const PRIORITY_KEYS: Record<Priority, 'low' | 'medium' | 'high' | 'critical'> = {
  1: 'low',
  2: 'medium',
  3: 'high',
  4: 'critical',
}

/** The fixed 8-colour soft tag palette. Order = auto-assignment order. */
export const TAG_COLORS = [
  'blue',
  'green',
  'amber',
  'violet',
  'red',
  'teal',
  'orange',
  'slate',
] as const satisfies readonly TagColor[]

export const TAG_COLOR_LABELS: Record<TagColor, string> = {
  slate: 'Grey',
  red: 'Red',
  orange: 'Orange',
  amber: 'Yellow',
  green: 'Green',
  teal: 'Teal',
  blue: 'Blue',
  violet: 'Violet',
}

export const VIEW_IDS = [
  'today',
  'week',
  'everything',
  'list',
  'timeline',
  'calendar',
] as const satisfies readonly ViewId[]

export const VIEW_LABELS: Record<ViewId, string> = {
  today: 'Today',
  week: 'This Week',
  everything: 'Everything',
  list: 'List',
  timeline: 'Timeline',
  calendar: 'Calendar',
}

export const BOARD_SCOPES: readonly BoardScope[] = ['today', 'week', 'everything']

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  weekStartsOn: 1,
  shortcuts: {
    toggleApp: 'Alt+Shift+T',
    quickAdd: 'Alt+Shift+N',
  },
  launchAtLogin: false,
  boardSort: { today: 'priority', week: 'priority', everything: 'priority' },
  detailPanelWidth: 480,
  lastView: 'today',
  windowBounds: null,
}

export const DETAIL_PANEL_MIN_WIDTH = 360
export const DETAIL_PANEL_MAX_WIDTH = 900

/** Soft-deleted tasks older than this are purged at startup. */
export const SOFT_DELETE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

/** Below this gap between neighbours a status column is renumbered. */
export const POSITION_EPSILON = 1e-6

export const MAX_TITLE_LENGTH = 500
export const MAX_DESCRIPTION_LENGTH = 200_000
export const MAX_TAG_NAME_LENGTH = 50

/**
 * Backups kept per kind (the kind is encoded in the file name, see main/services/backup.ts):
 * automatic startup/daily snapshots, manual "Back up now", and safety copies taken before an
 * import replaces data.
 */
export const BACKUP_KEEP = { auto: 14, manual: 10, preimport: 5 } as const
export const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000

/** Debounce for title/description autosave in the detail panel. */
export const AUTOSAVE_DEBOUNCE_MS = 500
