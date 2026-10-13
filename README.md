# Family Court digital forms

Online versions of the Family Court's application forms (Fm-C-B series), the public
status page, and the staff admin panel, with the backend service that stores filings,
attachments and the audit trail.

- **Start here:** `docs/INTEGRATION_HANDOVER.md` — what exists, how to run it, how to connect the Court's systems.
- **API:** `backend/openapi.yaml` (machine-readable), `backend/API.md` (prose).
- **Background and designs for later steps (notifications, OTP, security checklist):** `docs/IT_SETUP_GUIDE.md`.
- **Testing with Court staff:** `docs/TESTING_GUIDE.md`; sample filings for a test installation with `backend/seed-sample.js`.

## Layout

| Path | Contents |
|---|---|
| `app/` | static site, no build step: `form.html` (every form, by `?form=Fm-C-B20`), `index.html`, `wizard.html`, `status.html`, `print.html`, `admin.html`; form definitions in `app/specs/` |
| `backend/` | Node 22.5+ service with no dependencies; SQLite or JSON storage; tests, smoke test, Dockerfile |
| `deploy/` | nginx configuration and systemd unit; `docker-compose.yml` at the root runs the whole system |
| `docs/` | handover, setup guide, testing guide, CSV column list |

## Quick start

Requirements: Node.js 22.5 or later (or Docker). Nothing to install with npm.

```sh
cd backend
node user-cli.js add <username> "<Full name>" admin    # asks for a password
node server.js
```

Open http://localhost:4000/ for the forms and http://localhost:4000/admin.html for the
admin panel. The backend serves the site and the API on one address; no other setting
is needed. Optional: `node seed-sample.js http://localhost:4000 2 <username> <password>`
adds sample filings for every form.

With Docker instead: `docker compose up -d`, then
`docker compose exec forms node user-cli.js add <username> "<Full name>" admin`; the site
is on port 8080.

For a server installation (storage, HTTPS, service, backups) see
`docs/INTEGRATION_HANDOVER.md`. Tests: `node backend/test.js`.
