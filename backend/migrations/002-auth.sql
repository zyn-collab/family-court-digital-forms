-- ===========================================================================
-- Family Court digital forms — SQLite migration 002 (staff auth + audit)
-- ---------------------------------------------------------------------------
-- Adds the tables that back
-- authorization, append-only audit trail). Applied at boot by store-sqlite.js
-- when PRAGMA user_version < 2; user_version is bumped to 2 in the same
-- transaction, so this file runs exactly once per database.
--
-- The JSON store keeps equivalent objects in data/users.json, data/sessions.json
-- and the append-only data/audit.jsonl, so FC_STORE=json and FC_STORE=sqlite
-- expose the identical store interface (createUser / getUserByUsername /
-- getUserById / listUsers / setUserActive / setUserPassword / createSession /
-- getSession / touchSession / deleteSession / insertAudit / listAudit).
--
-- Conventions that must match the JSON store exactly:
--   * Timestamps are INTEGER epoch-milliseconds (Date.now()), never TEXT/ISO.
--   * `active` is INTEGER 1/0; the store normalizes it to a JS boolean on read.
--   * A session token is NEVER stored raw — only sha256(token) lives here, so a
--     database leak cannot hand an attacker a usable token.
--   * `audit_log` is append-only: no UPDATE/DELETE is issued against it anywhere
--     in the codebase, and no HTTP route can touch it except the read endpoint.
-- ===========================================================================

-- Court staff accounts. Created by backend/user-cli.js ONLY (no HTTP signup).
CREATE TABLE staff_users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    display_name  TEXT NOT NULL,                     -- shown internally as the actor
    password_hash TEXT NOT NULL,                     -- scrypt$<saltHex>$<hashHex>
    role          TEXT NOT NULL DEFAULT 'officer',   -- viewer|officer|registrar|admin
    active        INTEGER NOT NULL DEFAULT 1,        -- 1 = can log in, 0 = disabled
    created_at    INTEGER
);

-- Server-side sessions. token_hash = sha256(raw token). 8h expiry, slid forward
-- on use. Deleting a user cascades their sessions (they should stop working).
CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES staff_users (id) ON DELETE CASCADE,
    created_at INTEGER,
    expires_at INTEGER,
    last_used  INTEGER
);
CREATE INDEX sessions_user_idx    ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- Append-only audit trail. One row per admin-side event, including failed and
-- rate-limited logins. actor_* are NULL for anonymous events (e.g. login_fail).
-- No foreign key on actor_user_id on purpose: an audit write must never fail.
CREATE TABLE audit_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    at            INTEGER NOT NULL,                  -- epoch ms
    actor_user_id INTEGER,                           -- staff user id, or NULL
    actor_name    TEXT,                              -- display name, or NULL
    action        TEXT NOT NULL,                     -- login_ok|login_fail|login_rate_limited|logout|view_full|status_change
    ref_code      TEXT,                              -- submission ref when relevant
    ip            TEXT,                              -- client IP (socket or trusted XFF)
    details       TEXT                               -- JSON string, e.g. {"from":"submitted","to":"processing"}
);
CREATE INDEX audit_ref_idx ON audit_log (ref_code);
CREATE INDEX audit_at_idx  ON audit_log (at);
