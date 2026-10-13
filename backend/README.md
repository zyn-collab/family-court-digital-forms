# Reference backend

A runnable, **zero-dependency** reference implementation of the server the
digital forms need. It exists so the Court's IT team has a concrete, working
contract to build the production service against — and so switching the app
from browser-only storage to a real backend is a one-line change, already
tested.

**Status: this is a reference, not a production server.** It stores data in
JSON files by default (or the built-in SQLite store with `FC_STORE=sqlite`).
The security-critical parts are real: staff log in with their
own account, sessions and passwords are stored hashed, roles are enforced on the
server, and every staff action is written to an audit trail. It demonstrates the
full flow correctly; production must still add the items in "Going to
production" below.

## Run it

```bash
cd family-court-forms/backend
node server.js
# → Family Court reference backend on http://localhost:4000
```

Environment variables (all optional):
- `FC_PORT` — port (default `4000`)
- `FC_STORE` — `json` (default) or `sqlite`; picks where data is stored
- `FC_ALLOW_ORIGIN` — CORS origin (default `*`, dev only; see "Production
  settings")
- `FC_TRUST_PROXY` — set to `1` only when behind a reverse proxy (see
  "Production settings")

There is no admin password variable — staff log in with their own accounts (see
"Staff accounts" below).

Runtime data is written to `./data` (drafts, submissions) and `./uploads`
(extracted attachment files, one folder per submission). Both are gitignored.

Test the whole flow (no server needed to be running — the test starts one):
```bash
node test.js      # save draft → load → submit → status → admin login → list → update → attachment on disk
```

## Point the app at it

The frontend already has a matching data layer, `app/js/api-config.js`. To make
a page use the backend instead of localStorage, change its script include:

```js
// app/js/site-config.js
window.FC_API_BASE = 'http://localhost:4000';   // '' keeps the browser-only demonstration mode
```

That is the only frontend setting: `js/data-layer.js` loads `api-config.js` when
it is set and `browser-store.js` (browser store) when it is empty, and both
expose the same interface. The public demo site ships with it empty.

**Smoke test an installation:** `node smoke.js https://<host> <username> <password>`
walks health → reference → draft → submission with files → status → login → list →
record → attachment → status change → audit → export and prints OK or FAIL per step.

**Docker:** `docker compose up -d` at the repository root starts the service and an
nginx that serves `app/` and proxies `/api/` (`backend/Dockerfile`,
`deploy/nginx.conf`); `deploy/familycourt-forms.service` is the systemd unit for a
plain install.

See `API.md` for the full endpoint contract and `schema.sql` for the production
data model.

## Staff accounts

Staff accounts are managed **only** from the command line, on the server, with
`node user-cli.js`. There is deliberately no sign-up page and no user-management
HTTP endpoint — this keeps the attack surface as small as possible.

**Create the first account before anyone can log in.** A fresh install has no
staff users at all, so nobody can sign in until you make one. From
`family-court-forms/backend`:

```bash
node user-cli.js add registrar1 "Aminath Registrar" officer
```

It asks for a password twice (typing is hidden; minimum 8 characters) and prints
the new user's id. That person can now log in.

Run the CLI with the **same** `FC_STORE` you run the server with (`json`
default, or `FC_STORE=sqlite`), or the CLI and the server will read and write
different data.

Roles — what each may do:

| Role | May do |
|------|--------|
| `viewer` | Log in, list submissions, open a full submission record. Read-only. |
| `officer` | Everything a viewer can, **plus** change a submission's status and read the audit log. |
| `registrar` | Same access as `officer` (they rank equally in the code today). |
| `admin` | Highest role; can do everything `officer` can. No extra powers are wired up yet — reserved for future admin-only features. |

Other commands:

```bash
node user-cli.js list                   # list every account and whether it is active
node user-cli.js deactivate <username>  # stop an account logging in (e.g. a leaver)
node user-cli.js passwd <username>       # set a new password for an account
```

`deactivate` blocks new logins immediately, and any session the account still
holds stops working on that user's next request. Use it — not deletion — the
moment someone leaves.

## Sessions

- A successful login returns a token that the admin page keeps in the browser
  tab's storage, so it is **gone when the tab is closed** — there is no "keep me
  signed in".
- Sessions last **8 hours**. The expiry slides forward while the account is
  actively used (it is pushed out again once the session is more than an hour
  old), so a working user is not logged out mid-task, but an idle session
  expires.
- Only a hash of the token is stored in the database, never the token itself, so
  a copy of the database cannot be used to log in.

## Production settings

These matter once the server is reachable from outside your own machine.

- **`FC_ALLOW_ORIGIN`** — the web origin allowed to call the API (CORS). It
  defaults to `*`, which is fine on your own machine for development but must
  **not** be left as `*` in production. In production set it to the Court's exact
  site origin, e.g. `FC_ALLOW_ORIGIN=https://marriage.gov.mv`.
- **`FC_TRUST_PROXY=1`** — set this **only** when the server runs behind a
  reverse proxy (nginx, a load balancer, a cloud front end). It tells the server
  to read the real client IP from the `X-Forwarded-For` header, so rate limiting
  and the audit log see each visitor's IP rather than the proxy's. Do not set it
  when the server faces the internet directly — a caller could then fake the
  header to dodge the rate limits.
- **HTTPS is required in production, and it is the host's job.** The Node server
  speaks plain HTTP only. Put it behind a reverse proxy or platform that
  terminates HTTPS (TLS) and forwards to it — that is also where
  `FC_TRUST_PROXY=1` applies.

## Audit log

Every staff-side event is written to an **append-only** audit trail (a
`data/audit.jsonl` file with the JSON store, or the `audit_log` table with
SQLite). Nothing in the server can edit or delete an audit entry — there is
deliberately no endpoint that updates or removes a row.

Recorded events (the `action` value on each row):

| `action` | Written when |
|----------|--------------|
| `login_ok` | A staff member logged in successfully. |
| `login_fail` | A failed login. The **username tried** and the IP are recorded; the password is never logged. |
| `login_rate_limited` | A login attempt was rejected for exceeding the login rate limit. |
| `logout` | A staff member logged out. |
| `view_full` | A staff member opened a full submission record. |
| `status_change` | A submission's status was changed (records who, the case, and the old → new status). |

Officers (and above) can read the trail without database access via
`GET /api/admin/audit?ref=<case>&limit=<n>`, newest first.

## Rate limits

Simple in-memory, per-IP limits protect the two endpoints that face the public:

- **Admin login** — 5 attempts per minute per IP.
- **Public status lookup** — 20 requests per minute per IP.

Going over the limit returns HTTP **429** and the request is not processed. A
blocked *login* attempt is itself audited (`login_rate_limited`); a blocked
status lookup is not. The counters live in the server's memory and reset when it
restarts, so behind several server instances you should also enforce the real
limit at the load balancer.

Every per-address limit can be multiplied with `FC_RATE_SCALE` (default 1). Set it,
for example, to 10 for a testing session where many people share one office connection;
the per-username login limit is not scaled.

## Attachments

Uploads arrive inside the submission as data URIs. The server decodes each one,
decides the type from the file's own bytes (PNG, JPEG, GIF, WEBP, PDF, DOC, DOCX —
anything else is refused), enforces `FC_MAX_FILE_MB` (default 10); issues reference numbers on `POST /api/refs` (random, checked against every draft and submission, reserved as an empty draft — the pages ask for one when a form opens) and refuses a draft on a number that has been submitted, writes it under
`FC_UPLOADS_DIR/<ref>/<field>.<ext>` and stores `@file:<name>` in the record in
place of the base64. Staff view a file through
`GET /api/admin/submissions/<ref>/attachments/<name>` (session required, audited);
there is no public route into the uploads folder.

## Backups and restore

`node backup.js` (same `FC_*` variables as the service) writes, under
`FC_BACKUP_DIR` (default `backend/backups`):
- `familycourt-<stamp>.db` — a consistent copy of the SQLite database, taken while
  the server runs (`FC_STORE=sqlite`), or `data-<stamp>/` for the JSON store;
- `uploads-<stamp>/` — a copy of the uploads folder (`FC_BACKUP_UPLOADS=0` to skip).

Copy both off the machine. **Restore drill** (do it once before go-live, and date
it): stop the service; move the current database aside; copy a backup `.db` to
`FC_DB_PATH` and the matching `uploads-<stamp>` contents into `FC_UPLOADS_DIR`;
start the service; log in and open a case whose attachment you know. Delete old
backups on a schedule the Court decides.

## Staff accounts from the admin page

An `admin` account sees "Staff accounts" in the panel: list, add, deactivate or
activate, set a password — the same operations as `user-cli.js`, over
`/api/admin/users` (see `API.md`), each audited. The first admin is still created
with the CLI on the server.

## Events to the Court's system

`events.js` posts every submission, status change and correction to
`FC_EVENT_WEBHOOK` (full record + attachment paths) and appends every event to
`FC_EVENT_LOG_PATH`; `GET /api/admin/export` pulls the same records in pages.
Details and a worked example: `docs/INTEGRATION_HANDOVER.md` section 4.

## Notifications

`notify.js` runs after every submission and every status change. Each SMS / email is
appended to `FC_OUTBOX_PATH` (default `data/outbox.jsonl`) as one JSON line and, when
`FC_SMS_WEBHOOK` / `FC_EMAIL_WEBHOOK` are set, posted there as JSON with
`Authorization: Bearer <FC_WEBHOOK_TOKEN>`. A non-2xx answer or a timeout is recorded
in the line (`delivered: false`, `error`) and never fails the request that caused it.
`FC_PUBLIC_SITE` is used for the status link in the text. The step-by-step for the
Court's IT team is `docs/INTEGRATION_HANDOVER.md`; every variable is in `.env.example`.

## Going to production

The reference intentionally stops short of these — they need real infrastructure
decisions from the Court's IT team:

1. **Database** — replace the JSON-file store with the tables in `schema.sql`
   (or run the built-in `FC_STORE=sqlite` store on durable storage).
2. **Staff authentication** — already built here (per-account scrypt-hashed
   passwords, database-backed sessions, role checks, audit trail; see "Staff
   accounts", "Sessions" and "Audit log" above). For production you still
   terminate HTTPS at the host and keep the account and audit data on encrypted,
   backed-up storage.
3. **Object storage** for attachments (S3/GCS/managed disk) instead of base64.
4. **Encryption at rest** and **backups** for submissions and files.
5. **Rate limiting** — a basic in-memory per-IP limiter is built in (see "Rate
   limits"). Behind multiple server instances, also enforce the limit at the
   load balancer, since the counters are per-process.
6. **Payment + SMS** integrations, called at submit time.
7. **CORS** restricted to the Court's own web origin (`FC_ALLOW_ORIGIN`).
