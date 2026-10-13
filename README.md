# Family Court digital forms

Online versions of the Family Court's application forms (Fm-C-B series), the public
status page and the staff admin panel, with the backend service that stores filings,
attachments and the audit trail.

## Run it on your computer

You need [Node.js](https://nodejs.org) 22.5 or later. Nothing else is installed.

```sh
git clone https://github.com/zyn-collab/family-court-digital-forms.git
cd family-court-digital-forms/backend
node user-cli.js add <username> "<Full name>" admin    # asks you to choose a password
node server.js
```

Then open:

- http://localhost:4000/ for the public forms
- http://localhost:4000/admin.html for the admin panel (log in with the account created above)

To fill the admin panel with sample cases for every form, open a second terminal in the same `backend` folder, while the server keeps running, and run:

```sh
node seed-sample.js http://localhost:4000 2 <username> <password>
```

With Docker instead of Node.js: `docker compose up -d`, then
`docker compose exec forms node user-cli.js add <username> "<Full name>" admin`. The site
is on port 8080.

## Next steps

| Document | What it covers |
|---|---|
| [Integration handover](docs/INTEGRATION_HANDOVER.md) | What exists, installing on a server (storage, HTTPS, service, backups), connecting the Court's systems, roles |
| [Testing guide](docs/TESTING_GUIDE.md) | Setting up a test installation, what testers should try, how to report problems |
| [Setup guide](docs/IT_SETUP_GUIDE.md) | Background, data storage, notifications, one-time passcode design, security checklist |
| [API](backend/API.md) and [OpenAPI file](backend/openapi.yaml) | Every endpoint, for connecting other systems |
| [CSV columns](docs/EXPORT_COLUMNS.md) | The columns of the admin panel's export, per form |

## Layout

| Path | Contents |
|---|---|
| `app/` | the site, no build step: `form.html` (every form, by `?form=Fm-C-B20`), `index.html`, `wizard.html`, `status.html`, `print.html`, `admin.html`; form definitions in `app/specs/` |
| `backend/` | the service (Node.js, no third-party packages); SQLite or JSON storage; tests (`node test.js`), smoke test, sample loader, Dockerfile |
| `deploy/` | nginx HTTPS front and systemd unit; `docker-compose.yml` at the root runs the whole system |
| `docs/` | handover, testing guide, setup guide, CSV column list |
