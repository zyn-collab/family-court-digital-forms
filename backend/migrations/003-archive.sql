-- Case archiving kept on the server, so every officer sees the same worklist.
-- NULL = active; an epoch-ms timestamp = archived (hidden from the default list,
-- never deleted, restorable).
ALTER TABLE submissions ADD COLUMN archived_at INTEGER;
