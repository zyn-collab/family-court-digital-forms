# Family Court digital forms

Online versions of the Family Court's application forms (Fm-C-B series), the public
status page, and the staff admin panel, with the backend service that stores filings,
attachments and the audit trail.

- **Start here:** `docs/INTEGRATION_HANDOVER.md` — what exists, how to run it, how to connect the Court's systems.
- **API:** `backend/openapi.yaml` (machine-readable), `backend/API.md` (prose).
- **Background and designs for later steps (notifications, OTP, security checklist):** `docs/IT_SETUP_GUIDE.md`.

## Layout

| Path | Contents |
|---|---|
| `app/` | static site, no build step: `form.html` (every form, by `?form=Fm-C-B20`), `index.html`, `wizard.html`, `status.html`, `print.html`, `admin.html`; form definitions in `app/specs/` |
| `app/js/site-config.js` | the only frontend setting: the backend address |
| `backend/` | Node 22.5+ service with no dependencies; SQLite or JSON storage; tests, smoke test, Dockerfile |
| `deploy/` | nginx configuration and systemd unit; `docker-compose.yml` at the root runs the whole system |
| `docs/` | handover, setup guide, CSV column list |

## Quick start

```sh
cd backend
cp .env.example .env        # edit the paths and the site origin
node server.js              # http://localhost:4000/api/health
node user-cli.js add <username> "<Display name>" admin
node test.js                # 81 checks; FC_STORE=sqlite node test.js for the SQLite store
```

Serve `app/` from any static web server (or `docker compose up -d` for both), set
`FC_API_BASE` in `app/js/site-config.js`, and run `node backend/smoke.js <site> <username> <password>`.
