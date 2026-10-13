# Family Court digital forms — setup guide for the Court's IT team

*For a small IT team. No prior knowledge of this project is assumed. Where a step needs a decision from the Court (not IT), it says so.*

---

## 1. What the system is, in one page

| Piece | What it is |
|---|---|
| **The site** (`app/` folder) | Plain HTML/JavaScript pages: the front page, the guided start, the 17 forms, the status page, the print view and the staff admin panel. No build step. |
| **The backend** (`backend/` folder) | A small Node.js server that stores drafts, submissions, uploaded files, staff accounts and the audit log, answers the site's requests, and also serves the site itself. |

One process runs everything: `node server.js` serves the site and the API on one address (by default port 4000). Nothing else has to be installed or configured to try it.

**What the machine needs**
- Node.js 22.5 or newer (the built-in database arrived in that version). Nothing else: the server has no third-party packages, so there is nothing to install with `npm` and nothing that can silently update. Docker can be used instead (section 2).
- One folder on a disk that is backed up, for the database file and uploaded documents.
- For public use, an HTTPS front (nginx, IIS with ARR, Caddy, or the Court's load balancer) passing traffic to the Node process. The Node server speaks plain HTTP only, on purpose.
- Very little capacity: a 1-CPU, 1–2 GB virtual machine handles the Court's volume many times over. Disk grows with uploads (up to about 20 MB per filing with photos).

---

## 2. Setting it up — step by step

1. **Get the code** from the GitHub repository (`git clone …`), for example to `/srv/familycourt` or `C:\familycourt`.
2. **Check Node:** `node --version` must print `v22.5` or higher (install the current LTS from https://nodejs.org if not).
3. **Settings (optional for a first run):** copy `backend/.env.example` to `backend/.env` and change what is needed. For real use set `FC_STORE=sqlite` (already set in the example) and put the database and uploads on backed-up storage (`FC_DB_PATH`, `FC_UPLOADS_DIR`). The server, `user-cli.js` and `backup.js` all read this file, so they always use the same database.
4. **Create the first staff account** (nobody can log in until one exists):
   ```
   cd backend
   node user-cli.js add <username> "<Full name>" admin
   ```
   It asks for the password twice (hidden while typing, minimum 8 characters). Further accounts are created by an admin in the admin panel, under "Staff accounts".
5. **Start it:** `node server.js`. It prints the site and admin addresses. Open `http://<server>:4000/` for the forms and `http://<server>:4000/admin.html` for the admin panel.
6. **Keep it running** as a service, so it restarts after a reboot or crash: `deploy/familycourt-forms.service` for Linux (systemd; its header lists the commands), or NSSM on Windows pointing at `node server.js` in the `backend` folder.
   With Docker instead of steps 2–6: `docker compose up -d` at the repository root, then `docker compose exec forms node user-cli.js add <username> "<Full name>" admin`; the site is on port 8080.
7. **Put HTTPS in front** for anything beyond an internal trial: `deploy/nginx.conf` is a reference that passes everything to the backend. Set `FC_TRUST_PROXY=1` so rate limits and the audit log see the visitor's address rather than the proxy's.
8. **Prove it works:** `node backend/smoke.js https://<address> <username> <password>` must print OK on every line. Then file a form from a phone, look its number up on the status page, and open it in the admin panel.

**Settings most often changed** (full list with explanations in `backend/.env.example`)

| Variable | Meaning | Production value |
|---|---|---|
| `FC_STORE` | `json` (files) or `sqlite` (database) | `sqlite` |
| `FC_DB_PATH`, `FC_UPLOADS_DIR` | database file, folder for uploaded documents | on backed-up storage |
| `FC_PORT` | port the server listens on | `4000` (any free port) |
| `FC_TRUST_PROXY` | read the visitor's address from the HTTPS front | `1` behind a proxy |
| `FC_ALLOW_ORIGIN` | only if the site is served from a different address than the API | unset |
| `FC_RATE_SCALE` | per-connection request limits (multiple of a strict reference) | `20` (default); `0` turns them off |
| `FC_MAX_FILE_MB` | largest single uploaded document | `10` (default) |
| `FC_BACKUP_DIR` | where `backup.js` writes | a different disk from the data |

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
- Staff: everything, after logging in, according to role. There is no self-registration: the first admin account is created on the server with `user-cli.js`, and further accounts by an admin in the admin panel ("Staff accounts"), every change audited.

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
| `app/js/site-config.js` | the backend address, only needed when another web server serves `app/` |
| `backend/` | the service (`server.js`), stores, accounts (`user-cli.js`), tests (`test.js`), smoke test (`smoke.js`), `openapi.yaml`, `API.md`, `Dockerfile`, `.env.example` |
| `deploy/` | nginx configuration and systemd unit; `docker-compose.yml` at the root |
| `docs/` | this guide, `INTEGRATION_HANDOVER.md`, `EXPORT_COLUMNS.md` (CSV columns per form) |
