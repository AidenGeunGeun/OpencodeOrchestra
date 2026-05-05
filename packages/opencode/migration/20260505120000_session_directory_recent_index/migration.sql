CREATE INDEX IF NOT EXISTS `session_directory_recent_idx` ON `session` (`project_id`,`workspace_id`,`directory`,`parent_id`,`time_updated` DESC);
