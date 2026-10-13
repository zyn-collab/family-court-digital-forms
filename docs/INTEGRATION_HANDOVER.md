# Integration handover — for the Family Court IT team

Written for the engineers who will host the service, connect the Court's systems and
run the admin panel. It states what exists, what is configuration rather than code,
and the order of work to a first real filing. The HTTP contract is in
`backend/openapi.yaml` (machine-readable) and `backend/API.md` (prose). Background
and the longer explanations are in `docs/IT_SETUP_GUIDE.md`.

## 1. What is finished and tested

| Part | Where | State |
|---|---|---|
| 17 digital forms (verbatim text, validation, Dhivehi interface, PDF) | `app/` (static files, no build step) | running at the demonstration site; form definitions in `app/specs/` |
| Backend service, zero dependencies, Node 22.5 or later | `backend/server.js` | 87 automated checks per store (`node test.js`, `FC_STORE=sqlite node test.js`) |
| Storage: SQLite (built-in `node:sqlite`, recommended) or JSON files | `backend/store-sqlite.js`, `store-json.js`, `schema.sql`, `migrations/` | both pass the same suite |
| Reference numbers issued and checked by the server | `POST /api/refs` | unique; a submitted number refuses a new draft |
| Drafts, submissions, public status by reference number | `/api/drafts`, `/api/submissions` | the status route never returns form data |
| Attachments as files on disk, type read from the bytes, size capped | `FC_UPLOADS_DIR/<ref>/` | `@file:` markers in the record; streamed to staff with an audit row |
| Staff accounts: hashed passwords, roles, sessions, lockout, rate limits | `backend/auth.js`, `user-cli.js`, admin panel | no default password exists |
| Staff account management in the admin panel | `app/admin.html`, "Staff accounts" (admin role) | list, add, deactivate, activate, set password; all audited |
| Audit log, append-only | `GET /api/admin/audit` | login, view, status change, attachment view, correction, export, account changes; no route can edit or delete it |
| Admin panel | `app/admin.html` | list, filter, open a case with Dhivehi labels, view files, change status with a note, archive (kept on the server, so every officer shares one worklist), print with attachments, CSV export, audit |
| Returned-case corrections | `POST /api/submissions/:ref/corrections` | the citizen replaces one document; status returns to processing |
| Push to the Court's system | `backend/events.js`, `FC_EVENT_WEBHOOK` | every submission, status change and correction POSTed as JSON; all events logged |
| Pull for the Court's system | `GET /api/admin/export` | full records, oldest first, paged |
| SMS and email outbox with a gateway hook | `backend/notify.js` | every message written to `outbox.jsonl`; posted to a webhook when one is configured |
| Backups and restore | `backend/backup.js` | database and uploads folder |
| Container and service files | `backend/Dockerfile`, `docker-compose.yml`, `deploy/nginx.conf`, `deploy/familycourt-forms.service` | whole system on one host |
| Smoke test against an installation | `backend/smoke.js` | one command walks the whole path |
| Sample filings for a test installation | `backend/seed-sample.js` | every form, all questions answered, spread over the statuses |
| Testing guide | `docs/TESTING_GUIDE.md` | setting up a test installation; what public-side and admin-side testers should try; how to report problems |

Not built until the Court supplies the inputs: the SMS and email gateway itself, a one-time passcode on the phone number, eFaas login, a case-register lookup for case numbers, bot protection.

## 2. Go-live sequence

**First run, on any machine with Node.js 22.5 or later (about five minutes):**

```
git clone <repository address>
cd family-court-digital-forms/backend
node user-cli.js add <username> "<Full name>" admin
node server.js
```

Open `http://localhost:4000/` for the forms and `http://localhost:4000/admin.html` for the admin panel. The backend serves the site and the API on one address, so nothing else needs configuring. `node seed-sample.js http://localhost:4000 2 <username> <password>` adds sample filings for every form.

**On a server:** copy `backend/.env.example` to `backend/.env` and set the storage paths (section 3); run the server as a service (`deploy/familycourt-forms.service` for systemd, NSSM on Windows); put HTTPS in front (`deploy/nginx.conf` passes everything to the backend) and set `FC_TRUST_PROXY=1`.

**With Docker:** `docker compose up -d` at the repository root, then `docker compose exec forms node user-cli.js add <username> "<Full name>" admin`. The site is on port 8080; data is kept in the `fc-data` volume.

**Then, in order:**

1. `curl https://<host>/api/health` answers `{"ok":true}`.
2. Further staff accounts are created by the admin in the panel, under "Staff accounts".
3. Run the smoke test: `node backend/smoke.js https://<host> <username> <password>`. Every line must read OK. It leaves one test case, which staff archive from the panel.
4. Schedule `node backend/backup.js` nightly and test one restore (`backend/README.md`, "Backups and restore").

## 3. Configuration

Everything is an environment variable; `backend/.env.example` lists every one with a production value. The frontend has exactly one setting, `FC_API_BASE` in `app/js/site-config.js`. With it empty the pages run in demonstration mode (data stays in the browser; the admin page cannot log in). With it set, every page talks to the service. Nothing else in `app/` changes between the two modes.

Request limits per connection are generous by default (`FC_RATE_SCALE=20`), so an office of testers behind one connection is not held back; `0` turns them off. The limit of 10 failed logins per account in 10 minutes always applies.

Variables that must change from the defaults: `FC_ALLOW_ORIGIN`, `FC_STORE=sqlite`, `FC_DB_PATH`, `FC_UPLOADS_DIR`, `FC_TRUST_PROXY=1` behind a proxy, `FC_PUBLIC_SITE`.

## 4. Connecting the Court's systems

### 4.1 Every case change pushed to your system

Set `FC_EVENT_WEBHOOK` to an HTTPS endpoint of the case management system (or an integration service in front of it). The backend POSTs one JSON body per change, with `Authorization: Bearer <FC_WEBHOOK_TOKEN>` when the token is set:

```json
{ "id": "…uuid…", "event": "submitted", "at": 1760000000000,
  "ref_code": "VK-UV9WB2PQ", "form_code": "Fm-C-B20",
  "status": "submitted", "status_dv": "ހުށަހެޅިފައި",
  "actor": null,
  "record": { "ref_code": "VK-UV9WB2PQ", "form_code": "Fm-C-B20", "status": "submitted",
              "submitted_at": 1760000000000, "contact_number": "+9607712345", "id_number": "A123456",
              "data": { "applicant_full_name": "…", "applicant_id_document": "@file:applicant_id_document.jpg", "…": "…" },
              "attachments": ["applicant_id_document.jpg", "selfie_photo.png", "declarant_signature.png"],
              "history": [ { "status": "submitted", "timestamp": 1760000000000, "note": "" } ] },
  "attachments": [ { "name": "applicant_id_document.jpg",
                     "path": "/api/admin/submissions/VK-UV9WB2PQ/attachments/applicant_id_document.jpg" } ] }
```

Events: `submitted`, `status_change` (with `actor` = the officer, and the note in the last `history` entry), `correction`. Any 2xx answer counts as delivered. Anything else is recorded in `events.jsonl` with the error; the citizen's filing or the officer's action is never blocked. Files are fetched from the `path` with a staff bearer token, or read from `FC_UPLOADS_DIR/<ref>/` when the integration runs on the same host. The record's `data` keys are the field keys in `app/specs/<form>.json`; their Dhivehi labels are there too and in `docs/EXPORT_COLUMNS.md`.

### 4.2 Pulling instead of being pushed

`GET /api/admin/export?since=0&limit=500` with an officer or admin token returns full records oldest first with `next_since` and `more`; repeat with `since=<next_since>` until `more` is false. A nightly pull with the last `next_since` kept on your side gives the same result as the webhook. Each call is audited.

### 4.3 SMS and email

`notify.js` posts one JSON message per SMS or email to `FC_SMS_WEBHOOK` or `FC_EMAIL_WEBHOOK`:

```json
{ "id": "…", "channel": "sms", "to": "+9607712345", "event": "submitted",
  "ref_code": "VK-UV9WB2PQ", "form_code": "Fm-C-B20", "status": "submitted",
  "status_dv": "ހުށަހެޅިފައި", "note": "", "text_dv": "ފެމިލީ ކޯޓު: …", "created_at": 1760000000000 }
```

A small receiver maps this to the Court's SMS facility or the Dhiraagu / Ooredoo bulk-SMS API, and to the mail server for `channel: "email"`. Until it exists, `outbox.jsonl` holds every message and can be replayed. The Dhivehi texts are in `backend/notify.js` (`textFor`) and can be changed there.

### 4.4 Later integrations

- **One-time passcode on the phone number**: needs the SMS route; design in `docs/IT_SETUP_GUIDE.md` section 5, about a day of backend work, nothing changes in the forms.
- **Case numbers**: the forms lay the field out for the Court's numbering but do not check it. A read-only lookup from the case management system can sit behind a `GET /api/cases/:number` route and the form's panel will show the match.
- **Identity (eFaas)**: not built; the forms work without it (ID number, card photo and selfie checked by staff). A design note is available from the project team.
- **Courts list** for Fm-C-B03C 6.2.1: a JSON list in `app/data/`, no code change.

## 5. Data model

- Submission record: `ref_code`, `form_code`, `status`, `status_dv`, `submitted_at`, `contact_number`, `id_number`, `data` (answers keyed by field key), `attachments` (file names under the reference's upload folder), `history` (status changes with actor and note). Schemas in `backend/openapi.yaml`.
- SQLite tables: `backend/schema.sql` and `backend/migrations/`. The JSON store writes one file per record under `FC_DATA_DIR`.
- Statuses: submitted, processing, pending, approved, rejected, returned, completed. Dhivehi labels are set by the server.

## 6. Roles and accounts

| Role | Can |
|---|---|
| viewer | log in, list cases, open a case, view files, export CSV |
| officer | viewer plus change status with a note, read the audit log, pull `/api/admin/export` |
| admin | officer plus manage staff accounts in the panel |

Passwords are hashed; eight characters minimum. Deactivating an account or setting its password ends its open sessions. An account cannot deactivate itself. Ten failed logins for one username within ten minutes lock that username out for the rest of the ten minutes.

## 7. What stays with the project team

Form content, wording and validation live in `app/specs/<form>.json` (one file per form, plus the bundle `app/specs/specs-bundle.js` the pages load). Changes from the Court's reviews are made by the project team and delivered as updated files there; IT does not need to edit them to run the service.

## 8. Support

The service logs to standard output. `GET /api/health` reports the store and uptime. Rate limits and lockouts are described in `backend/README.md`. After any change to the server, `node test.js` and `FC_STORE=sqlite node test.js` must both print 0 failed; after any change to the installation, `node smoke.js` must print all steps passed.
