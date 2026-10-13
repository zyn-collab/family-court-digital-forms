# Backend API contract

This is the contract the frontend expects. The frontend data layer
(`app/js/api-config.js`) already speaks exactly this, so any backend that
implements these endpoints will work with the app unchanged. The reference
`server.js` implements all of it.

Base URL is configured on the frontend via `window.FC_API_BASE`.
All request/response bodies are JSON (UTF-8). Dhivehi is sent as normal UTF-8.

## Public (citizen) endpoints — no auth

| Method | Path | Body | Response | Notes |
|---|---|---|---|---|
| `POST` | `/api/refs` | `{ prefix?, form_code? }` | `{ ref_code }` | Issue a reference number: random, checked against every draft and submission, reserved as an empty draft. The pages call this when a form opens. |
| `PUT` | `/api/drafts/:ref` | `{ data }` | `{ ref_code }` or `409` | Create/replace a saved draft. `data` is the whole form payload (it carries `_step`, the page reached). `409` if the number has already been submitted. |
| `GET` | `/api/drafts/:ref` | — | `{ data }` or `404` | Load a draft. Expired drafts return 404. |
| `DELETE` | `/api/drafts/:ref` | — | `{ ok: true }` | |
| `PUT` | `/api/submissions/:ref` | `{ data }` | `{ ref_code, attachments }` | Submit. Server extracts uploaded files, stores the submission, deletes the draft. |
| `GET` | `/api/submissions/:ref/status` | — | status object or `404` | **Public** — returns only status/history, never the full form data. When the status is `returned` it also lists `attachment_fields` (field keys of the submitted documents, no contents). |
| `POST` | `/api/submissions/:ref/corrections` | `{ field, file }` | `{ ok, status }` | **Public, ref-gated, 10/min per IP.** Only while the case is `returned`: one replacement document (data URI, same type/size checks as submit) for `field`; the record's field points at the new file (`@file:corrN_<field>.<ext>`), the original stays, `data._corrections` lists what came in, status goes back to `processing`, audited as `correction`. |

Public status object:
```json
{ "ref_code": "...", "status": "processing", "status_dv": "...",
  "submitted_at": 1720000000000, "form_code": "Fm-C-B20", "history": [ ... ] }
```

## Admin endpoints — require a bearer token

`POST /api/admin/login` with `{ "username": "...", "password": "..." }` →
`{ "token": "...", "display_name": "...", "role": "..." }` (per-staff accounts,
created with `user-cli.js`; 5 attempts/min per IP and 10 per 10 min per username).
Send the token on every admin call: `Authorization: Bearer <token>`.
`POST /api/admin/logout` ends the session.

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/api/admin/submissions` | — | `{ submissions: [ {ref_code, status, status_dv, submitted_at, form_code, contact_number, id_number} ] }` |
| `GET` | `/api/admin/submissions/:ref` | — | full submission record (incl. `data`, `history`, `attachments`) |
| `POST` | `/api/admin/submissions/:ref/status` | `{ status, note }` | `{ ok: true }` — `status` must be one of submitted/processing/pending/approved/rejected/returned/completed; the Dhivehi label is set by the server; `note` ≤ 500 chars |
| `GET` | `/api/admin/submissions/:ref/attachments/:filename` | — | the stored file (image/PDF), audited as `attachment_view` |
| `GET` | `/api/admin/audit?ref=&limit=` | — | `{ audit: [...] }` (officer+) |
| `POST` | `/api/admin/submissions/:ref/archive` | `{ archived: true\|false }` | `{ ok, archived }` (officer+) — archived cases leave the default worklist for every officer; nothing is deleted; audited as `archive` / `restore`; the list returns `archived_at` |
| `GET` | `/api/admin/export?since=&limit=` | — | `{ submissions: [full records, oldest first], next_since, more }` (officer+; `limit` ≤ 500; page with `since = next_since`; audited as `export`) |
| `GET` | `/api/admin/users` | — | `{ users: [{id, username, display_name, role, active, created_at}] }` (admin role) |
| `POST` | `/api/admin/users` | `{ username, display_name, role, password }` | `{ user }` — username `[a-z0-9._-]{3,40}`, role viewer/officer/admin, password ≥ 8 chars; `409` if taken; audited `user_create` |
| `POST` | `/api/admin/users/:username/active` | `{ active: true\|false }` | `{ ok }` — deactivating ends the account's sessions; an account cannot deactivate itself (`400`); audited `user_active` |
| `POST` | `/api/admin/users/:username/password` | `{ password }` | `{ ok }` — ends the account's sessions; audited `user_password` |
| `GET` | `/api/health` | — | `{ ok, store, uptime_s }` (public, no data) |

Submission `data` is validated on the server (object of scalar / array values, keys
`[A-Za-z0-9_.-]`, ≤ 3000 fields, strings ≤ 20 000 chars). Uploads arrive as data URIs;
the server decodes them, checks the real file type from the bytes (PNG, JPEG, GIF,
WEBP, PDF, DOC, DOCX) and size (`FC_MAX_FILE_MB`, default 10), writes them under
`FC_UPLOADS_DIR/<ref>/`, and stores `@file:<name>` in the record instead of the base64.
A rejected file fails the whole submit with `400 { error, field }`.

## Events to the Court's own system

With `FC_EVENT_WEBHOOK` set, `backend/events.js` POSTs one JSON body per change —
`submitted`, `status_change` (with the acting officer and the note), `correction` —
carrying the full record and the attachment download paths; `Authorization: Bearer
<FC_WEBHOOK_TOKEN>` when set. Any 2xx is delivered; anything else is recorded with
the error in `FC_EVENT_LOG_PATH` (every event is logged there, delivered or not) and
never fails the request that caused it. The body is the `Event` schema in
`openapi.yaml`; the worked example is in `docs/INTEGRATION_HANDOVER.md` section 4.
`GET /api/admin/export` is the pull-based equivalent.

## How the frontend maps to this

`app/js/api-config.js` implements the same `window.DataStore` interface the
app already uses, so switching a page from localStorage to the backend is just:

```js
// app/js/site-config.js — the one frontend setting
window.FC_API_BASE = 'https://forms.familycourt.gov.mv';   // '' = browser-only demonstration mode
```

Every page loads `js/site-config.js` then `js/data-layer.js`, which picks
`api-config.js` when the address is set and `browser-store.js` (browser store)
when it is empty; `admin.html` always uses the API layer.
The admin page additionally calls `DataStore.adminLogin(password)` once
before listing submissions.

## What production must add on top of the reference server

Built since this section was first written: per-staff accounts with hashed passwords,
sessions and roles (`auth.js`, `user-cli.js`); rate limits on the public status route,
drafts and login; attachments as files on disk with type and size checks; the SQLite
store; backups (`backup.js`); a notification outbox with a webhook hook (`notify.js`).
What remains for the Court's installation:

- **HTTPS and CORS**: terminate TLS in front of the service and set `FC_ALLOW_ORIGIN` to the site's origin (the default `*` is for development).
- **The SMS / email gateway**: point `FC_SMS_WEBHOOK` / `FC_EMAIL_WEBHOOK` at a receiver that talks to the Court's provider; until then every message waits in `outbox.jsonl`.
- **Encryption at rest** for the database file and the uploads folder (disk or volume level), and a tested restore.
- **Payment**, if the fee is ever collected online, wired at submit time.
- **OTP / eFaas / case-register lookup**: see `docs/INTEGRATION_HANDOVER.md`.
