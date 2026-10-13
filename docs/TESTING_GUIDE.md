# Testing guide

For the IT team preparing a test installation, and for the Court staff who will test
the public forms and the admin panel. Nothing entered on a test installation is a
real case.

## 1. Preparing the test installation (IT)

1. Install as in `docs/INTEGRATION_HANDOVER.md` section 2, on a test server with its
   own address (for example `test-forms.familycourt.gov.mv`).
2. Leave `FC_RATE_SCALE` at its default (20). The request limits then never affect an
   office of testers sharing one internet connection.
3. Set `FC_API_BASE` in `app/js/site-config.js` to the test address.
4. Create the accounts:
   ```
   node user-cli.js add <username> "<Full name>" admin      # one per IT administrator
   node user-cli.js add <username> "<Full name>" officer    # one per admin-side tester
   node user-cli.js add <username> "<Full name>" viewer     # to test the read-only role
   ```
   Further accounts can then be created by an admin in the panel, under "Staff accounts".
5. Optional: load sample filings so admin-side testers can start before any public
   filing exists. Every form gets filings with all questions answered, spread over the
   statuses:
   ```
   node seed-sample.js https://test-forms.familycourt.gov.mv 2 <officer username> <password>
   ```
   Never run this against the production installation.
6. Run `node smoke.js https://test-forms.familycourt.gov.mv <officer username> <password>`.
   Every line must read OK.

## 2. Public-side testing

Start at the site's front page or the guided start (`wizard.html`), and file real-looking
forms with invented details. Points to cover:

| Area | What to try |
|---|---|
| Every form | Complete it to the end, with every attachment and the signature and photo; note the reference number shown at the end |
| Guided start | Answer the questions and confirm the right form opens, with the earlier answers carried over |
| Validation | Leave required questions empty, enter an age under 18, a wrong ID number, a date in the wrong order; the page must not move on and must say why |
| Saving | Close the browser halfway, reopen the form; then look the reference number up on another device (status page) and continue from there |
| Attachments | Photos from a phone camera, PDFs, Word files; a file over 10 MB must be refused |
| PDF | Print the completed form; attachments appear on numbered sheets at the end |
| Status page | Look up a filed case by its number; after staff return a case, replace the requested document there |
| Phone | Repeat a few forms on a phone |

## 3. Admin-side testing

Log in at `admin.html` with the account IT created.

| Area | What to try |
|---|---|
| Worklist | Filter by form, status and date; show and hide archived cases |
| A case | Open it with **View**: every answer under its Dhivehi question, every attachment viewable |
| Status | Move cases through processing, pending, returned, approved, rejected and completed, with a note each time; check on the public status page that the applicant sees the change |
| Returned case | Return a case, replace the document from the public status page, and confirm the case comes back to processing with the replacement listed |
| Archive | Archive a case and confirm another officer no longer sees it in the default list |
| Print | Print a case; attachments appear on numbered sheets |
| Export | Export CSV for one form and for all forms; open in Excel |
| Audit | Open the audit trail of a case and confirm every view and change is recorded with the officer's name |
| Roles | Repeat with a viewer account (no status changes) and an admin account (Staff accounts panel) |

## 4. Reporting a problem

One report per problem, with:

- the reference number of the case, if there is one;
- the form, the page and the question;
- what was done, what happened, and what was expected;
- a screenshot;
- the device and browser (for example "Android phone, Chrome").

Reports are best kept as GitHub Issues on the repository, one issue per problem, so each
can be assigned, discussed and closed.
