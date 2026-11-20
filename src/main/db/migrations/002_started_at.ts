// Actual start tracking (spec §4): `started_at` is the instant a task left Not Started.
// Backfill rows that predate it — the true start is unknown:
// - done: zero length, `started_at = completed_at` (else updated_at), the user's rule for a
//   start nobody saw;
// - in_progress / blocked: `created_at`, the explainable lower bound;
// - not_started: NULL.
export const sql = /* sql */ `
ALTER TABLE tasks ADD COLUMN started_at INTEGER;
UPDATE tasks SET started_at = COALESCE(completed_at, updated_at) WHERE status = 'done';
UPDATE tasks SET started_at = created_at WHERE status IN ('in_progress', 'blocked');
`
