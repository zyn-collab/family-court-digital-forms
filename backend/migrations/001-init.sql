-- ===========================================================================
-- Family Court digital forms — SQLite migration 001 (initial schema)
-- ---------------------------------------------------------------------------
-- SQLite translation of the drafts / submissions / submission_history tables
-- from backend/schema.sql (the PostgreSQL reference model). Applied at boot by
-- store-sqlite.js when PRAGMA user_version < 1; user_version is bumped to 1 in
-- the same transaction, so this file runs exactly once per database.
--
-- NOT in this migration (deliberately): the users / sessions / audit_log and
-- normalized attachments-metadata tables. Those arrive as migrations 002/003
-- alongside and 03 (attachments).
--
-- Conventions that must match the JSON store exactly:
--   * Timestamps are INTEGER epoch-milliseconds (Date.now()), never TEXT/ISO.
--   * JSON payloads (form data, member_forms, attachment path list) live in
--     TEXT columns as JSON.stringify output — same serialization as the file
--     store, so a record round-trips to the identical shape from either store.
-- ===========================================================================

-- Saved but not-yet-submitted forms. Short-lived; purged past expires_at.
CREATE TABLE drafts (
    ref_code     TEXT PRIMARY KEY,        -- e.g. VS-ABCD2345
    form_code    TEXT,                    -- "Fm-C-B20" or "A+B+C" for a combined draft
    member_forms TEXT,                    -- JSON array of codes for combined drafts, else NULL
    data         TEXT NOT NULL,           -- JSON.stringify of the whole form payload
    saved_at     INTEGER,                 -- epoch ms
    expires_at   INTEGER                  -- epoch ms; server purges/rejects past this
);
CREATE INDEX drafts_expires_idx ON drafts (expires_at);

-- Submitted forms.
CREATE TABLE submissions (
    ref_code       TEXT PRIMARY KEY,
    form_code      TEXT,
    data           TEXT NOT NULL,         -- JSON.stringify of the full submission payload
    id_number      TEXT,                  -- denormalized for quick admin search
    contact_number TEXT,
    status         TEXT NOT NULL DEFAULT 'submitted',   -- submitted|processing|pending|approved|rejected|returned|completed
    status_dv      TEXT,
    submitted_at   INTEGER,               -- epoch ms
    -- attachments: JSON array of stored file paths (the list produced by the
    -- server's persistAttachments at submit time, e.g. ["uploads/REF/selfie.png"]).
    -- This mirrors the JSON store's submission.attachments field and the
    -- GET /api/admin/submissions/:ref contract, so both stores return the same
    -- record shape. It is distinct from the future normalized attachments
    -- *metadata* table (content_type/size/storage_path) introduced in spec 03;
    -- this column is just the denormalized path list carried on the submission.
    attachments    TEXT
);
CREATE INDEX submissions_status_idx ON submissions (status);
CREATE INDEX submissions_idnum_idx  ON submissions (id_number);
CREATE INDEX submissions_form_idx   ON submissions (form_code);

-- Status change history (one row per change; the app shows this as a timeline).
-- Reassembled at the read boundary into history:[{status,status_dv,timestamp,note}]
-- ordered by (changed_at, id). changed_by / changed_by_name stay NULL until the
-- staff-auth work (spec 02) fills them in from the authenticated actor.
CREATE TABLE submission_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ref_code        TEXT NOT NULL REFERENCES submissions (ref_code) ON DELETE CASCADE,
    status          TEXT,
    status_dv       TEXT,
    note            TEXT,
    changed_by      INTEGER,             -- staff user id (once auth exists, spec 02)
    changed_by_name TEXT,               -- denormalized staff name (spec 02)
    changed_at      INTEGER              -- epoch ms; maps to history[].timestamp
);
CREATE INDEX submission_history_ref_idx ON submission_history (ref_code);
