'use strict';
/*
 * Smoke test against a RUNNING installation (not the unit suite — that is test.js).
 *
 * node smoke.js https://forms.familycourt.gov.mv <staff-username> <password>
 *
 * Walks the whole path once: health, reference number, draft, submission with an
 * attachment, public status, staff login, case list, full record, attachment
 * download, status change, audit, export. Prints one line per step; exit code 1 on
 * the first failure. Leaves one test case in the store (status "rejected", note
 * "smoke test") — archive it from the admin page afterwards.
 */
const BASE = (process.argv[2] || 'http://localhost:4000').replace(/\/$/, '');
const USER = process.argv[3] || '';
const PASS = process.argv[4] || '';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
let failed = 0;
function step(name, ok, info) { console.log((ok ? 'OK   ' : 'FAIL ') + name + (info ? '  — ' + info : '')); if (!ok) failed++; }
const J = (r) => r.json();
const jsonHdr = { 'Content-Type': 'application/json' };

(async () => {
  const health = await fetch(BASE + '/api/health').then(J).catch((e) => ({ error: String(e) }));
  step('health', health.ok === true, JSON.stringify(health));
  if (health.ok !== true) process.exit(1);

  const issued = await fetch(BASE + '/api/refs', { method: 'POST', headers: jsonHdr, body: JSON.stringify({ prefix: 'SM', form_code: 'Fm-C-B20' }) }).then(J);
  const ref = issued.ref_code;
  step('reference number issued', /^SM-[A-Z0-9]{8}$/.test(ref || ''), ref);

  const draft = await fetch(BASE + '/api/drafts/' + ref, { method: 'PUT', headers: jsonHdr, body: JSON.stringify({ data: { applicant_full_name: 'ސްމޯކް ޓެސްޓް', form_code: 'Fm-C-B20', _step: 2 } }) });
  step('draft saved', draft.status === 200, 'HTTP ' + draft.status);
  const back = await fetch(BASE + '/api/drafts/' + ref).then(J);
  step('draft read back (Dhivehi intact)', back.data && back.data.applicant_full_name === 'ސްމޯކް ޓެސްޓް');

  const sub = await fetch(BASE + '/api/submissions/' + ref, { method: 'PUT', headers: jsonHdr,
    body: JSON.stringify({ data: { applicant_full_name: 'ސްމޯކް ޓެސްޓް', form_code: 'Fm-C-B20', id_number: 'A000000', contact_number: '+9607000000', applicant_id_document: PNG, selfie_photo: PNG, declarant_signature: PNG } }) }).then(J);
  step('submitted with attachments', sub.ref_code === ref && Array.isArray(sub.attachments) && sub.attachments.length === 3, JSON.stringify(sub));

  const pub = await fetch(BASE + '/api/submissions/' + ref + '/status').then(J);
  step('public status without form data', pub.status === 'submitted' && pub.data === undefined, pub.status_dv);

  if (!USER) { console.log('\n(no staff credentials given: admin steps skipped)'); process.exit(failed ? 1 : 0); }

  const login = await fetch(BASE + '/api/admin/login', { method: 'POST', headers: jsonHdr, body: JSON.stringify({ username: USER, password: PASS }) }).then(J);
  step('staff login', !!login.token, login.role ? 'role ' + login.role : JSON.stringify(login));
  if (!login.token) process.exit(1);
  const H = { 'Authorization': 'Bearer ' + login.token, 'Content-Type': 'application/json' };

  const list = await fetch(BASE + '/api/admin/submissions', { headers: H }).then(J);
  step('case list contains the case', (list.submissions || []).some((s) => s.ref_code === ref), (list.submissions || []).length + ' cases');
  const full = await fetch(BASE + '/api/admin/submissions/' + ref, { headers: H }).then(J);
  step('full record: answers present, files as markers', full.data && full.data.applicant_full_name === 'ސްމޯކް ޓެސްޓް' && /^@file:/.test(full.data.applicant_id_document || ''), full.data && full.data.applicant_id_document);
  const firstFile = String((full.attachments || [])[0] || '').split('/').pop();
  const att = await fetch(BASE + '/api/admin/submissions/' + ref + '/attachments/' + encodeURIComponent(firstFile), { headers: H });
  step('attachment downloads', att.status === 200 && /image/.test(att.headers.get('content-type') || ''), att.headers.get('content-type'));

  const st = await fetch(BASE + '/api/admin/submissions/' + ref + '/status', { method: 'POST', headers: H, body: JSON.stringify({ status: 'rejected', note: 'smoke test' }) });
  step('status change (officer role needed)', st.status === 200 || st.status === 403, 'HTTP ' + st.status + (st.status === 403 ? ' (viewer account: expected)' : ''));
  const pub2 = await fetch(BASE + '/api/submissions/' + ref + '/status').then(J);
  step('citizen sees the new status', st.status === 403 || pub2.status === 'rejected', pub2.status_dv);

  const audit = await fetch(BASE + '/api/admin/audit?ref=' + ref, { headers: H });
  step('audit log for the case', audit.status === 200 || audit.status === 403, 'HTTP ' + audit.status);
  const exp = await fetch(BASE + '/api/admin/export?since=0&limit=5', { headers: H });
  step('export endpoint', exp.status === 200 || exp.status === 403, 'HTTP ' + exp.status);

  console.log('\n' + (failed ? failed + ' step(s) failed' : 'all steps passed') + ' — test case ' + ref + ' left in the store');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
