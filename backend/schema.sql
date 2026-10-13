-- ===========================================================================
-- Family Court digital forms — production data model
-- ---------------------------------------------------------------------------
-- The reference server (server.js) uses JSON files for simplicity, but this is
-- the shape a production database should use. Written for PostgreSQL; adjust
-- types for MySQL/SQL Server as needed. This is the target the Court's IT team
-- should build against.
-- ===========================================================================

-- Saved but not-yet-submitted forms. Short-lived (purge on expiry).
CREATE TABLE drafts (
    ref_code    TEXT PRIMARY KEY,           -- e.g. VS-ABCD2345 (client- or server-generated)
    form_code   TEXT,                       -- "Fm-C-B20" or "A+B+C" for a combined draft
    member_forms TEXT,                      -- JSON array of codes for combined drafts, else NULL
    data        JSONB NOT NULL,             -- the whole form payload (field key -> value)
    saved_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL        -- server should reject/purge past this
);
CREATE INDEX drafts_expires_idx ON drafts (expires_at);

-- Submitted forms.
CREATE TABLE submissions (
    ref_code       TEXT PRIMARY KEY,
    form_code      TEXT NOT NULL,
    data           JSONB NOT NULL,          -- full submission (large text/narratives, etc.)
    id_number      TEXT,                    -- denormalized for quick admin search
    contact_number TEXT,
    status         TEXT NOT NULL DEFAULT 'submitted',   -- submitted|processing|pending|approved|rejected|returned|completed
    status_dv      TEXT NOT NULL,
    submitted_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX submissions_status_idx  ON submissions (status);
CREATE INDEX submissions_idnum_idx   ON submissions (id_number);
CREATE INDEX submissions_form_idx    ON submissions (form_code);

-- Status change history (one row per change; the app shows this as a timeline).
CREATE TABLE submission_history (
    id           BIGSERIAL PRIMARY KEY,
    ref_code     TEXT NOT NULL REFERENCES submissions (ref_code) ON DELETE CASCADE,
    status       TEXT NOT NULL,
    status_dv    TEXT NOT NULL,
    note         TEXT,
    changed_by   TEXT,                      -- staff user id (once auth exists)
    changed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX submission_history_ref_idx ON submission_history (ref_code);

-- Uploaded files (ID photos, selfies, signatures, receipts, documents).
-- In production, store the binary in object storage (S3/GCS/disk) and keep only
-- a reference here — do NOT keep base64 blobs in the row long-term.
CREATE TABLE attachments (
    id           BIGSERIAL PRIMARY KEY,
    ref_code     TEXT NOT NULL REFERENCES submissions (ref_code) ON DELETE CASCADE,
    field_key    TEXT NOT NULL,             -- which form field it came from (e.g. selfie_photo)
    content_type TEXT NOT NULL,             -- image/png, application/pdf, ...
    storage_path TEXT NOT NULL,             -- path/URL in object storage
    size_bytes   BIGINT,
    uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX attachments_ref_idx ON attachments (ref_code);

-- Court staff accounts (for admin auth — the reference server stubs this).
CREATE TABLE staff_users (
    id            BIGSERIAL PRIMARY KEY,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,            -- bcrypt/argon2 — never store plaintext
    role          TEXT NOT NULL DEFAULT 'officer',  -- officer|registrar|admin
    active        BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
