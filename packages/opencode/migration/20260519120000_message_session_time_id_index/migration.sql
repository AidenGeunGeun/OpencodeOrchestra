CREATE INDEX IF NOT EXISTS `message_session_time_id_idx` ON `message` (`session_id`,`time_created` DESC,`id` DESC);--> statement-breakpoint
-- OCO: the new compound index has (session_id, ...) as its prefix, so a
-- standalone (session_id) index is now redundant. Dropping it saves disk and
-- one extra write per message insert. Safe because the planner picks the
-- compound-prefix path automatically for `WHERE session_id = ?` lookups.
DROP INDEX IF EXISTS `message_session_idx`;
