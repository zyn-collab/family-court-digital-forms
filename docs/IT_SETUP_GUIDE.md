# Family Court digital forms — setup guide for the Court's IT team

*Written for a small IT team. No prior knowledge of this project is assumed. Where a step needs a decision from the Court (not IT), it says so.*

---

## 1. What the system is, in one page

The digital forms are two pieces:

| Piece | What it is | Where it runs today | Where it should run for real filings |
|---|---|---|---|
| **The website** (`app/` folder) | Plain HTML/JavaScript pages: the landing page, the question flow, the 17 forms, the status-lookup page and the staff admin page. No server code. | Vercel (a free static-hosting service), rebuilt on every push to GitHub: https://marriagegovmv.vercel.app/ | Any web server that can serve static files over HTTPS — Vercel can stay, or the Court's own web server. |
| **The backend** (`backend/` folder) | A small Node.js server that stores drafts, submissions, uploaded files, staff accounts and the audit log, and answers the website's requests. | **Nowhere yet.** The live site stores everything inside the visitor's own browser (a demo arrangement). Nothing reaches the Court. | A server the Court controls, behind HTTPS. This is the one thing that must exist before the first real filing. |

Until the backend is hosted, the live site is a working demonstration only: a citizen who fills a form on their phone has that form on their phone and nowhere else, and the admin page shows nothing.

**What the backend needs from the machine it runs on**
- Node.js 22.5 or newer (the built-in database support arrived in that version). No other software: the server has zero third-party packages, so there is nothing to install with `npm` and nothing that can silently update.
- One folder on a disk that is backed up, for the database file and uploaded documents.
- An HTTPS "front door" (a reverse proxy such as nginx, IIS with ARR, or Caddy) that receives `https://…` traffic and passes it to the Node process on an internal port. The Node server itself speaks plain HTTP only, on purpose.
- Very little capacity: a 1-CPU, 1–2 GB virtual machine handles the Court's volume many times over. Disk grows with uploads (assume up to ~20 MB per filing with photos).

---

## 2. Setting the backend up — step by step

> Shorter route: `docs/INTEGRATION_HANDOVER.md` has the Docker and systemd go-live, and the frontend now has a single setting, `app/js/site-config.js`, instead of edits on each page.

These steps assume a Linux or Windows server on which you can open a terminal.

1. **Get the code.** Copy the `family-court-forms` folder from the GitHub repository (https://github.com/zyn-collab/marriagegovmv) to the server, e.g. `/srv/familycourt` or `C:\familycourt`.
2. **Check Node.** Run `node --version`. It must print `v22.5` or higher. If not, install the current LTS from https://nodejs.org.
3. **Choose where data lives.** Create a folder on backed-up storage, e.g. `/srv/familycourt-data` (Linux) or `D:\familycourt-data` (Windows), containing two sub-folders: `db` and `uploads`.
4. **Run the server once by hand** to confirm it starts:
   ```
   cd family-court-forms/backend
   FC_STORE=sqlite FC_DB_PATH=/srv/familycourt-data/db/familycourt.db FC_UPLOADS_DIR=/srv/familycourt-data/uploads FC_PORT=4000 node server.js
   ```
   (On Windows PowerShell set the variables first: `$env:FC_STORE='sqlite'` and so on, then `node server.js`.) It prints `Family Court reference backend on http://localhost:4000`. Stop it with Ctrl+C.
5. **Create the first staff account.** Nobody can log in until one exists:
   ```
   FC_STORE=sqlite FC_DB_PATH=/srv/familycourt-data/db/familycourt.db node user-cli.js add registrar1 "Aminath Registrar" registrar
   ```
   It asks for a password twice (hidden while typing, minimum 8 characters). Use the same `FC_STORE` / `FC_DB_PATH` values as the server, or the two will look at different databases.
   Roles: `viewer` (read only), `officer` and `registrar` (may change a case's status and read the audit log), `admin` (reserved for future admin-only features). When someone leaves: `node user-cli.js deactivate <username>` — do not delete accounts, the audit log refers to them.
6. **Keep it running.** Register the server as a service so it restarts after a reboot or crash:
   - Linux: a `systemd` unit with `ExecStart=/usr/bin/node /srv/familycourt/family-court-forms/backend/server.js`, `Restart=always`, and the environment variables from step 4 in an `EnvironmentFile`.
   - Windows: NSSM ("Non-Sucking Service Manager") or Task Scheduler "At startup", pointing at the same command with the same variables.
7. **Put HTTPS in front.** Configure the reverse proxy to forward `https://api.familycourt.gov.mv/` (any name the Court chooses) to `http://127.0.0.1:4000/`. Obtain a certificate (Let's Encrypt is free and automatic in Caddy and in nginx with certbot). Then set two more variables on the service:
   - `FC_TRUST_PROXY=1` — so rate limits and the audit log see the citizen's real address, not the proxy's. Set this **only** when a proxy is in front.
   - `FC_ALLOW_ORIGIN=https://marriagegovmv.vercel.app` (or the Court's site address once it has one) — the only website allowed to call the API. Never leave it as `*` in production.
8. **Point the website at the backend.** In `app/form.html`, `app/status.html` and `app/print.html`, replace the line
   `<script src="js/browser-store.js"></script>` with
   ```
   <script>window.FC_API_BASE = 'https://api.familycourt.gov.mv';</script>
   <script src="js/api-config.js"></script>
   ```
   (`app/admin.html` already uses `api-config.js`; set the same `FC_API_BASE` there.) Commit and push; Vercel republishes within a minute. From that moment, forms save to the Court's server.
9. **Prove it works.** Open the site, start a form, note the reference number, close the tab, reopen the status page and look the number up. Log in to `app/admin.html` with the account from step 5 and see the draft/submission. Check `/srv/familycourt-data/uploads/<reference>/` for the uploaded files.

**Full list of settings (environment variables)**

| Variable | Meaning | Production value |
|---|---|---|
| `FC_STORE` | `json` (files, demo) or `sqlite` (real database) | `sqlite` |
| `FC_DB_PATH` | the database file | on backed-up storage |
| `FC_UPLOADS_DIR` | folder for uploaded documents | on backed-up storage |
| `FC_PORT` | internal port the proxy forwards to | `4000` (any free port) |
| `FC_ALLOW_ORIGIN` | the website's address | the Court's site, never `*` |
| `FC_TRUST_PROXY` | read the real client IP from the proxy | `1` behind a proxy, unset otherwise |
| `FC_MAX_FILE_MB` | largest single uploaded document | `10` (default) |
| `FC_BACKUP_DIR` | where `backup.js` writes | on a different disk from the data |
| `FC_DEV` | allows starting with `FC_ALLOW_ORIGIN` unset | never set in production |

---

## 3. How the data is stored

- **Database:** one SQLite file (`familycourt.db`). SQLite is a full relational database in a single file, used by (among others) every Android phone and every Firefox install; for the Court's volume it is the right size and needs no database server, no administrator and no licence. Tables: `drafts`, `submissions`, `submission_history` (the status timeline), `staff_users`, `sessions`, `audit_log`. The same layout is written out for PostgreSQL in `backend/schema.sql` should the Court later want a shared database server.
- **Uploaded documents** (ID cards, certificates, receipts, the signature and the selfie) are written to `FC_UPLOADS_DIR/<reference number>/` at submit time; the database keeps the form's answers.
- **Drafts** (forms started but not submitted) expire after 7 days and are then deleted automatically. The citizen's reference number is the only key to a draft.
- **Submissions** are kept indefinitely today. **Court decision needed:** how long to keep completed and rejected cases, and their uploads, before archiving/deleting (the admin spec proposes auto-archive 7 days after completion; a legal retention period must be set by the Court).
- **Staff passwords** are stored as scrypt hashes, sessions as hashes of the token; a copy of the database cannot be used to log in or to recover a password.
- **Audit log:** every staff login, failed login, case opened, status change is appended and can never be edited or deleted through the server.
- **Encryption at rest** is the host's job: enable BitLocker (Windows) or LUKS (Linux) on the data volume.

**Backups.** Run `node backup.js` on a schedule (Task Scheduler / cron, daily is plenty) with the same variables as the service. It writes a consistent copy of the database to `familycourt-<date>.db` and a copy of the uploads folder next to it, under `FC_BACKUP_DIR`, while the server keeps running. Copy those off the machine (another server, an encrypted external disk, the Court's file server). Test a restore once: stop the service, put a backup file at `FC_DB_PATH`, start the service, log in. A backup you have never restored is not a backup.

**Who can see what**
- Citizens: only their own draft (by reference number) and the public status of a submission (status and timeline, never the form contents). When staff set a case to "returned for correction", the status page lets the citizen send one replacement document for it; the case then returns to "processing".
- Staff: everything, after logging in, according to role. There is no self-registration and no user-management web page; accounts are created only on the server with `user-cli.js`. This is deliberate.

---

## 4. Notifications by SMS and email

The last page of every form collects the phone number and email. The backend writes every message it would send — the receipt on submission and every status change made in the admin panel — to an outbox file (`FC_OUTBOX_PATH`, default `data/outbox.jsonl`), one JSON line per message, and posts the same JSON to `FC_SMS_WEBHOOK` or `FC_EMAIL_WEBHOOK` when those are set (`backend/notify.js`; the body is shown in `docs/INTEGRATION_HANDOVER.md` section 4). A failed post is recorded in the line and never blocks the filing. What it needs from the Court:

1. **An SMS route.** Either the Court's existing SMS facility, if it can be called from a program, or a bulk-SMS account from Dhiraagu or Ooredoo. IT writes a small receiver that accepts the JSON above and calls the provider; its address goes in `FC_SMS_WEBHOOK`, with a shared secret in `FC_WEBHOOK_TOKEN`.
2. **An email route.** The Court's mail server, behind a receiver of the same shape, in `FC_EMAIL_WEBHOOK`.
3. **Wording.** The received-message text and the status-change text are in `backend/notify.js` (`textFor`) and await the Court's confirmation.
4. **Cost note:** Thaana SMS uses the 70-character UCS-2 alphabet, so a message longer than 70 characters costs two segments.

Retries, per-case delivery status in the admin panel and vendor adapters inside the service (a fuller design is available from the project team) are left for after the gateway is known; the outbox is the complete record meanwhile.

---

## 5. One-time passcode (OTP) on the phone number

Purpose: make sure the phone number typed on the first page is real and belongs to the person, so the notifications reach them. Design (to be built on the backend once the SMS route exists; about a day of work):

1. Citizen types the number and presses "send code". The backend generates a 6-digit code, stores only a hash of it with a 5-minute expiry against the reference number, and sends it through the SMS route above.
2. Citizen types the code. The backend checks it (maximum 5 tries, then a new code must be requested; a new code may be requested at most once a minute) and marks the draft "phone verified".
3. Submission is accepted only for verified drafts; the admin page shows the verified number.

What IT must know:
- It **cannot** run on the website alone. A code generated in the browser can be read in the browser. It needs the hosted backend from section 2.
- If the SMS route cannot reach foreign numbers, the Court decides whether foreign numbers skip OTP or verify by email instead. The forms already accept any country code.
- Nothing about OTP changes the forms themselves; the first page already asks for the phone number.

---

## 6. Security checklist before the first real filing

- [ ] Backend reachable only through HTTPS; the Node port (4000) is not open to the internet (firewall rule).
- [ ] `FC_ALLOW_ORIGIN` set to the Court's site; `FC_TRUST_PROXY=1` set because a proxy is in front.
- [ ] `FC_STORE=sqlite`; database and uploads on an encrypted, backed-up volume; the `backend/data` folder is not world-readable.
- [ ] First staff accounts created; the person who created them has recorded who holds which role.
- [ ] Daily `backup.js` scheduled; one restore drill done and dated.
- [ ] Server logs go to a file that is rotated (systemd journal or NSSM's log rotation); they contain reference numbers and IPs, not form contents.
- [ ] Node.js updated on the server when a security release is announced (check nodejs.org quarterly).
- [ ] The three website pages point at the backend (section 2, step 8) and a test filing has been made and found in the admin page.

---

## 7. Where things are in the repository

| Path | What |
|---|---|
| `app/` | the site: forms (`form.html`), start page (`index.html`), guided start (`wizard.html`), status page (`status.html`), print view (`print.html`), admin panel (`admin.html`); `app/specs/` holds one definition per form |
| `app/js/site-config.js` | the one frontend setting (`FC_API_BASE`) |
| `backend/` | the service (`server.js`), stores, accounts (`user-cli.js`), tests (`test.js`), smoke test (`smoke.js`), `openapi.yaml`, `API.md`, `Dockerfile`, `.env.example` |
| `deploy/` | nginx configuration and systemd unit; `docker-compose.yml` at the root |
| `docs/` | this guide, `INTEGRATION_HANDOVER.md`, `EXPORT_COLUMNS.md` (CSV columns per form) |
