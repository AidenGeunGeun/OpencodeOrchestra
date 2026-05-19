-- OCO: expression index on JSON-extracted role + (time_created, id). Drives:
--   * `analytics.ts:records()` summary queries (role=, optional time_created>=)
--   * `analytics-store.ts:processChunk()` keyset backfill scan
--     (role=, (time_created, id) keyset cursor)
--   * `analytics-store.ts:countAssistantMessages()` and `hasPendingRowAfterWatermark()`
--   * `analytics-token-migration.ts` rewrite scans
-- `id` is part of the index so the backfill keyset cursor is fully covered.
-- SQLite (>= 3.9) supports indexes on deterministic expressions; json_extract
-- with a string-literal path is deterministic.
CREATE INDEX IF NOT EXISTS `message_role_time_idx` ON `message` (json_extract(`data`,'$.role'), `time_created`, `id`);--> statement-breakpoint
-- Refresh planner statistics so the first analytics query after this migration
-- picks the new index instead of guessing selectivity from defaults.
ANALYZE `message`;
