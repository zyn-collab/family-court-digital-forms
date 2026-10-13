/* Integration + store test for the reference backend. Starts the server
 * in-process and drives the whole flow over HTTP, then exercises the store
 * layer directly (persistence, purge, history order, cross-store parity,
 * migration idempotency), plus the spec-02 auth / authz / attribution / audit /
 * rate-limit checks.
 *
 * Run it TWICE — once per store — both must end "0 failed":
 *   node test.js                 # default = json (the reference file store)
 *   FC_STORE=sqlite node test.js # the node:sqlite store
 *
 * Staff accounts are created directly through the store (the same way user-cli.js
 * does) — there is no signup endpoint. Usernames are suffixed with a per-run id
 * so re-runs never collide in the persistent store, and the audit log is
 * append-only, so assertions filter to THIS run's rows.
 * (node:sqlite prints one ExperimentalWarning to stderr — expected, harmless.) */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.FC_OUTBOX_PATH = process.env.FC_OUTBOX_PATH || path.join(os.tmpdir(), 'fc-outbox-' + Date.now().toString(36) + '.jsonl');   // notify.js reads it at load
process.env.FC_RATE_SCALE = '1';   // the tests check the strict reference limits (production default is 20x)
process.env.FC_EVENT_LOG_PATH = process.env.FC_EVENT_LOG_PATH || path.join(os.tmpdir(), 'fc-events-' + Date.now().toString(36) + '.jsonl');   // events.js reads it at load
const { server, _resetRateLimits } = require('./server.js');
const auth = require('./auth.js');

const STORE = process.env.FC_STORE === 'sqlite' ? 'sqlite' : 'json';
// The SAME store singleton the in-process server uses (Node module cache), so
// seeding a user here makes it visible to the server immediately.
const storeSingleton = require(STORE === 'sqlite' ? './store-sqlite' : './store-json');

let pass = 0, fail = 0;
function check(name, ok, info) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info ? '  — ' + info : ''));
  ok ? pass++ : fail++;
}
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// isolated scratch area so store-level tests never touch the server's data
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-store-test-'));
function makeStore(kind, loc) {
  const mod = require(kind === 'sqlite' ? './store-sqlite' : './store-json');
  return kind === 'sqlite' ? mod.createStore({ dbPath: loc }) : mod.createStore({ dataDir: loc });
}
function cleanup() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ } }

(async () => {
  console.log('== backend test suite — store: ' + STORE + ' ==\n');
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const B = 'http://localhost:' + port;
  const J = (r) => r.json();
  const ref = 'TEST-' + Date.now().toString(36).toUpperCase();
  const RUN = Date.now().toString(36);

  // ── seed staff accounts directly in the store (as user-cli.js would) ──
  const OFFICER = 'off_' + RUN, OFFICER_PW = 'Officer-pass-1';
  const VIEWER = 'view_' + RUN, VIEWER_PW = 'Viewer-pass-1';
  const DEAD = 'dead_' + RUN, DEAD_PW = 'Dead-pass-1';
  const officer = storeSingleton.createUser({ username: OFFICER, display_name: 'Adam Officer', role: 'officer', password_hash: auth.hashPassword(OFFICER_PW), active: true, created_at: Date.now() });
  const viewer = storeSingleton.createUser({ username: VIEWER, display_name: 'Vaahid Viewer', role: 'viewer', password_hash: auth.hashPassword(VIEWER_PW), active: true, created_at: Date.now() });
  storeSingleton.createUser({ username: DEAD, display_name: 'Dhon Deactivated', role: 'officer', password_hash: auth.hashPassword(DEAD_PW), active: false, created_at: Date.now() });

  const jsonHdr = { 'Content-Type': 'application/json' };
  const loginBody = (u, p) => JSON.stringify({ username: u, password: p });

  try {
    // ===================== core public flow (unchanged) ====================
    // 1. draft save + load
    await fetch(B + '/api/drafts/' + ref, { method: 'PUT', headers: jsonHdr,
      body: JSON.stringify({ data: { applicant_full_name: 'ފާތިމަތު ޓެސްޓް', form_code: 'Fm-C-B20' } }) });
    const draft = await fetch(B + '/api/drafts/' + ref).then(J);
    check('draft save + load (Dhivehi preserved)', draft.data && draft.data.applicant_full_name === 'ފާތިމަތު ޓެސްޓް');

    // 2. submit (with an attachment)
    const sub = await fetch(B + '/api/submissions/' + ref, { method: 'PUT', headers: jsonHdr,
      body: JSON.stringify({ data: { applicant_full_name: 'ފާތިމަތު ޓެސްޓް', form_code: 'Fm-C-B20',
        id_number: 'A234567', contact_number: '7712345', selfie_photo: PNG, declarant_signature: PNG } }) }).then(J);
    check('submit returns ref + attachment list', sub.ref_code === ref && Array.isArray(sub.attachments) && sub.attachments.length === 2, JSON.stringify(sub.attachments));

    // 3. attachment files really landed on disk
    const upDir = path.join(__dirname, 'uploads', ref);
    const files = fs.existsSync(upDir) ? fs.readdirSync(upDir) : [];
    check('attachments written to disk', files.includes('selfie_photo.png') && files.includes('declarant_signature.png'), files.join(','));

    // 4. draft removed after submit
    const gone = await fetch(B + '/api/drafts/' + ref);
    check('draft deleted after submit', gone.status === 404);

    // 5. public status returns status but NOT the full form data
    const status = await fetch(B + '/api/submissions/' + ref + '/status').then(J);
    check('public status: status present, form data NOT leaked', status.status === 'submitted' && status.data === undefined);

    // 6. INVARIANT: a public re-submit cannot MUTATE an existing submission
    const resubmit = await fetch(B + '/api/submissions/' + ref, { method: 'PUT', headers: jsonHdr,
      body: JSON.stringify({ data: { form_code: 'Fm-C-B20', tampered: 'yes' } }) });
    check('public re-submit to an existing ref is rejected (409, cannot overwrite)', resubmit.status === 409);

    // ===================== ref + form_code validation ======================
    // 7. path-traversal ref on public submit → 400, and NOTHING escapes uploads/.
    // '..%2F..%2Fpwn-ATTACK01' decodes to '../../pwn-ATTACK01'; before the fix a
    // path.join(uploads, ref) would have written into the backend's parent dir.
    const travResp = await fetch(B + '/api/submissions/' + '..%2F..%2Fpwn-ATTACK01', { method: 'PUT', headers: jsonHdr,
      body: JSON.stringify({ data: { form_code: 'Fm-C-B20', selfie_photo: PNG } }) });
    const travPath = path.join(__dirname, '..', 'pwn-ATTACK01');   // where the traversal would land
    check('traversal ref on public submit rejected (400) and no file escapes uploads/',
      travResp.status === 400 && !fs.existsSync(travPath), 'status=' + travResp.status);

    // 8. garbage ref on public status GET (';drop--', URL-encoded) → 400
    const badStatus = await fetch(B + '/api/submissions/' + encodeURIComponent(';drop--') + '/status');
    check('garbage ref on public status rejected (400)', badStatus.status === 400, 'status=' + badStatus.status);

    // 8b. the server issues reference numbers: unique, reserved as a draft, right shape
    const issued = await fetch(B + '/api/refs', { method: 'POST', headers: jsonHdr, body: JSON.stringify({ prefix: 'VS', form_code: 'Fm-C-B20' }) }).then(J);
    const issued2 = await fetch(B + '/api/refs', { method: 'POST', headers: jsonHdr, body: JSON.stringify({ prefix: 'VS' }) }).then(J);
    const reserved = await fetch(B + '/api/drafts/' + issued.ref_code);
    check('POST /api/refs issues a well-formed number, reserved as a draft, two calls differ',
      /^VS-[23456789A-HJ-NP-Z]{8}$/.test(issued.ref_code || '') && issued.ref_code !== issued2.ref_code && reserved.status === 200,
      JSON.stringify([issued.ref_code, issued2.ref_code, reserved.status]));
    const badPrefix = await fetch(B + '/api/refs', { method: 'POST', headers: jsonHdr, body: JSON.stringify({ prefix: 'bad prefix' }) });
    check('POST /api/refs rejects a bad prefix (400)', badPrefix.status === 400, 'status=' + badPrefix.status);
    // 8c. a draft may never be written on a number that has been submitted
    const onSubmitted = await fetch(B + '/api/drafts/' + ref, { method: 'PUT', headers: jsonHdr, body: JSON.stringify({ data: { form_code: 'Fm-C-B20' } }) });
    check('draft PUT on a submitted number refused (409)', onSubmitted.status === 409, 'status=' + onSubmitted.status);

    // 9. bad ref on drafts PUT → 400
    const badDraft = await fetch(B + '/api/drafts/' + encodeURIComponent('bad ref!'), { method: 'PUT', headers: jsonHdr,
      body: JSON.stringify({ data: {} }) });
    check('bad ref on drafts PUT rejected (400)', badDraft.status === 400, 'status=' + badDraft.status);

    // 10. a valid ref still works end-to-end (regex isn't over-tight); this also
    // proves a normal form_code (Fm-C-B01) is accepted.
    const okRef = 'VS-OK' + RUN;   // run-unique: submit is create-only (409 on re-run otherwise)
    const okSubmit = await fetch(B + '/api/submissions/' + okRef, { method: 'PUT', headers: jsonHdr,
      body: JSON.stringify({ data: { form_code: 'Fm-C-B01' } }) });
    const okStatus = await fetch(B + '/api/submissions/' + okRef + '/status');
    check('valid ref (+ normal form_code) still works end-to-end (submit + status 200)',
      okSubmit.status === 200 && okStatus.status === 200, 'submit=' + okSubmit.status + ' status=' + okStatus.status);

    // 11. malicious form_code on submit → 400 'bad form_code'
    const badFC = await fetch(B + '/api/submissions/' + 'FC-BADCODE1', { method: 'PUT', headers: jsonHdr,
      body: JSON.stringify({ data: { form_code: '"><img src=x onerror=1>' } }) });
    const badFCj = await badFC.json();
    check('malicious form_code on submit rejected (400 bad form_code)',
      badFC.status === 400 && badFCj.error === 'bad form_code', 'status=' + badFC.status);

    // ===================== hardening ===================
    // 12. a traversal-shaped FIELD KEY cannot write outside uploads/ (400, nothing written)
    const badKeyRef = 'FC-BADKEY' + RUN;
    const badKey = await fetch(B + '/api/submissions/' + badKeyRef, { method: 'PUT', headers: jsonHdr,
      body: JSON.stringify({ data: { form_code: 'Fm-C-B20', '../../evil': PNG } }) });
    check('traversal field key on submit rejected (400) and nothing written',
      badKey.status === 400 && !fs.existsSync(path.join(__dirname, '..', 'evil.png')) && !fs.existsSync(path.join(__dirname, 'evil.png')), 'status=' + badKey.status);

    // 13. a file whose bytes are not an allowed type is rejected naming the field
    const fakePng = 'data:image/png;base64,' + Buffer.from('<?php echo 1; ?>').toString('base64');
    const badType = await fetch(B + '/api/submissions/' + 'FC-BADTYPE' + RUN, { method: 'PUT', headers: jsonHdr,
      body: JSON.stringify({ data: { form_code: 'Fm-C-B20', selfie_photo: fakePng } }) });
    const badTypeJ = await badType.json();
    check('upload with wrong magic bytes rejected (400, field named)',
      badType.status === 400 && badTypeJ.field === 'selfie_photo', 'status=' + badType.status + ' ' + JSON.stringify(badTypeJ));

    // 14. an oversized file (11 MB > FC_MAX_FILE_MB default 10) is rejected
    const bigRef = 'FC-BIG' + RUN;
    const big = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47]), Buffer.alloc(11 * 1024 * 1024)]).toString('base64');
    const bigRes = await fetch(B + '/api/submissions/' + bigRef, { method: 'PUT', headers: jsonHdr,
      body: JSON.stringify({ data: { form_code: 'Fm-C-B20', selfie_photo: big } }) });
    check('oversized upload rejected (400)', bigRes.status === 400, 'status=' + bigRes.status);

    // 15. stored data carries "@file:<name>" — base64 lives on disk only
    const stored = storeSingleton.getSubmission(ref);
    check('stored submission holds @file markers, not base64',
      stored && stored.data.selfie_photo === '@file:selfie_photo.png' && stored.data.declarant_signature === '@file:declarant_signature.png',
      JSON.stringify(stored && [stored.data.selfie_photo, stored.data.declarant_signature]));

    // 16. malformed data shapes rejected on drafts and submits
    const badShape = await fetch(B + '/api/drafts/' + ref + 'X', { method: 'PUT', headers: jsonHdr,
      body: JSON.stringify({ data: { 'ok_key': { nested: 'object' } } }) });
    check('nested object value rejected on draft PUT (400)', badShape.status === 400, 'status=' + badShape.status);
    const juris = await fetch(B + '/api/drafts/' + ref + 'J', { method: 'PUT', headers: jsonHdr,
      body: JSON.stringify({ data: { form_code: 'Fm-C-B15', jurisdiction_answers: { applicant_residence: { area: 'other', atoll: 'K', island: 'ތިލަފުށި' }, respondent_residence: { area: 'male' } } } }) });
    check('wizard location answers (jurisdiction_answers) accepted in their fixed shape', juris.status === 200, 'status=' + juris.status);
    const jurisDeep = await fetch(B + '/api/drafts/' + ref + 'K', { method: 'PUT', headers: jsonHdr,
      body: JSON.stringify({ data: { jurisdiction_answers: { applicant_residence: { area: { deeper: 'x' } } } } }) });
    check('jurisdiction_answers deeper than its shape rejected (400)', jurisDeep.status === 400, 'status=' + jurisDeep.status);

    // 17. health endpoint
    const health = await fetch(B + '/api/health').then(J);
    check('health endpoint answers without data', health.ok === true && typeof health.uptime_s === 'number');

    // 18. public submit is audited (no actor, with ref)
    const subRows = storeSingleton.listAudit({ limit: 5000 }).filter((r) => r.action === 'submit' && r.ref_code === ref);
    check('public submit audited', subRows.length === 1 && subRows[0].actor_user_id == null);

    // 19. drafts are rate-limited (121st request in a minute → 429)
    _resetRateLimits();
    let last = 200;
    for (let i = 0; i < 121; i++) {
      const r = await fetch(B + '/api/drafts/RL-' + RUN + 'X' + (i % 5));
      last = r.status;
    }
    check('draft route rate-limited (429 after 120/min)', last === 429, 'last=' + last);
    _resetRateLimits();

    // 20. security headers on every JSON response
    const hdr = await fetch(B + '/api/health');
    check('no-store + nosniff headers on responses',
      hdr.headers.get('cache-control') === 'no-store' && hdr.headers.get('x-content-type-options') === 'nosniff');

    // ===================== login + session (spec 02) =======================
    // unknown user / wrong password / deactivated user → SAME generic 401
    const lUnknown = await fetch(B + '/api/admin/login', { method: 'POST', headers: jsonHdr, body: loginBody('nobody_' + RUN, 'x') });
    check('login: unknown user rejected (401)', lUnknown.status === 401);
    const lWrong = await fetch(B + '/api/admin/login', { method: 'POST', headers: jsonHdr, body: loginBody(OFFICER, 'wrong-password') });
    check('login: wrong password rejected (401)', lWrong.status === 401);
    const lDead = await fetch(B + '/api/admin/login', { method: 'POST', headers: jsonHdr, body: loginBody(DEAD, DEAD_PW) });
    check('login: deactivated user rejected (401)', lDead.status === 401);

    // correct → token + display_name + role
    const lOk = await fetch(B + '/api/admin/login', { method: 'POST', headers: jsonHdr, body: loginBody(OFFICER, OFFICER_PW) }).then(J);
    check('login: correct credentials issue a token (+ display_name, role)',
      !!lOk.token && lOk.display_name === 'Adam Officer' && lOk.role === 'officer');
    const authH = { 'Authorization': 'Bearer ' + lOk.token, 'Content-Type': 'application/json' };

    // bad ref on an ADMIN route (with a valid officer session) → 400: proves the
    // shared ref check guards admin paths too, not just the public ones.
    const adminBadRef = await fetch(B + '/api/admin/submissions/' + encodeURIComponent('../../etc'), { headers: authH });
    check('bad ref on an admin route (valid session) rejected (400)', adminBadRef.status === 400, 'status=' + adminBadRef.status);

    // failed logins audited — with the attempted username, NEVER the password
    const failRows = storeSingleton.listAudit({ limit: 5000 }).filter((r) => r.action === 'login_fail');
    const deadFail = failRows.find((r) => { try { return JSON.parse(r.details).username === DEAD; } catch (e) { return false; } });
    check('login failure is audited (login_fail with attempted username, no password field)',
      !!deadFail && JSON.parse(deadFail.details).username === DEAD && !('password' in JSON.parse(deadFail.details)));
    // successful login audited with the SERVER-derived actor
    const okRows = storeSingleton.listAudit({ limit: 5000 }).filter((r) => r.action === 'login_ok' && r.actor_user_id === officer.id);
    check('login success is audited (login_ok with actor derived server-side)',
      okRows.length >= 1 && okRows[0].actor_name === 'Adam Officer');

    // expired session → 401 (force expires_at into the past)
    const expTok = auth.createSession(storeSingleton, officer.id);
    storeSingleton.touchSession(auth.sha256(expTok), Date.now() - 2000, Date.now() - 1000);
    const expRes = await fetch(B + '/api/admin/submissions', { headers: { 'Authorization': 'Bearer ' + expTok } });
    check('expired session rejected (401)', expRes.status === 401);

    // ===================== authorization (spec 02) =========================
    // list blocked without a token; allowed with one
    const noAuth = await fetch(B + '/api/admin/submissions');
    check('admin list blocked without token (401)', noAuth.status === 401);
    const list = await fetch(B + '/api/admin/submissions', { headers: authH }).then(J);
    check('admin list includes the submission', list.submissions.some((s) => s.ref_code === ref));

    // every /api/admin/* route → 401 with no token AND with a garbage token
    const routes = [
      ['GET', '/api/admin/submissions'],
      ['GET', '/api/admin/submissions/' + ref],
      ['POST', '/api/admin/submissions/' + ref + '/status'],
      ['GET', '/api/admin/audit'],
      ['POST', '/api/admin/logout']
    ];
    let allBlocked = true, blockInfo = '';
    for (const [m, p] of routes) {
      for (const hdr of [null, 'Bearer garbage-token-xyz']) {
        const h = { 'Content-Type': 'application/json' };
        if (hdr) h['Authorization'] = hdr;
        const r = await fetch(B + p, { method: m, headers: h, body: m === 'POST' ? '{}' : undefined });
        if (r.status !== 401) { allBlocked = false; blockInfo = m + ' ' + p + ' -> ' + r.status; }
      }
    }
    check('authz: every /api/admin/* route returns 401 without a valid session', allBlocked, blockInfo);

    // viewer: can read, cannot mutate
    const vOk = await fetch(B + '/api/admin/login', { method: 'POST', headers: jsonHdr, body: loginBody(VIEWER, VIEWER_PW) }).then(J);
    const viewerH = { 'Authorization': 'Bearer ' + vOk.token, 'Content-Type': 'application/json' };
    const vList = await fetch(B + '/api/admin/submissions', { headers: viewerH });
    check('authz: viewer can list submissions (200)', vList.status === 200);
    const vFull = await fetch(B + '/api/admin/submissions/' + ref, { headers: viewerH });
    check('authz: viewer can view a full record (200)', vFull.status === 200);
    const vUpd = await fetch(B + '/api/admin/submissions/' + ref + '/status', { method: 'POST', headers: viewerH,
      body: JSON.stringify({ status: 'processing', status_dv: 'ޕްރޮސެސް ކުރަނީ' }) });
    check('authz: viewer BLOCKED from status update (403)', vUpd.status === 403);

    // ===================== admin full + status (with attribution) ==========
    // full record has the data
    const full = await fetch(B + '/api/admin/submissions/' + ref, { headers: authH }).then(J);
    check('admin full record includes form data', full.data && full.data.id_number === 'A234567');

    // status update + public history recorded
    await fetch(B + '/api/admin/submissions/' + ref + '/status', { method: 'POST', headers: authH,
      body: JSON.stringify({ status: 'processing', status_dv: 'ޕްރޮސެސް ކުރަނީ', note: 'reviewing' }) });
    const status2 = await fetch(B + '/api/submissions/' + ref + '/status').then(J);
    check('status update + public history recorded', status2.status === 'processing' && status2.history.length === 2);

    // 21. status must be a known value; the Dhivehi label comes from the server; note is capped
    const badSt = await fetch(B + '/api/admin/submissions/' + ref + '/status', { method: 'POST', headers: authH,
      body: JSON.stringify({ status: '<script>', status_dv: 'x' }) });
    check('unknown status rejected (400)', badSt.status === 400, 'status=' + badSt.status);
    await fetch(B + '/api/admin/submissions/' + ref + '/status', { method: 'POST', headers: authH,
      body: JSON.stringify({ status: 'pending', status_dv: 'WRONG LABEL', note: 'n'.repeat(900) }) });
    const st3 = await fetch(B + '/api/submissions/' + ref + '/status').then(J);
    const lastH3 = st3.history[st3.history.length - 1];
    check('status label derived server-side and note capped at 500',
      st3.status_dv === 'ޕެންޑިންގް' && lastH3.status_dv === 'ޕެންޑިންގް' && lastH3.note.length === 500, JSON.stringify([st3.status_dv, lastH3.note.length]));

    // 22a. correction flow: only a "returned" case accepts a replacement document; it
    // goes back to processing, the record points at the new file, the old one stays
    const notRet = await fetch(B + '/api/submissions/' + ref + '/corrections', { method: 'POST', headers: jsonHdr,
      body: JSON.stringify({ field: 'selfie_photo', file: PNG }) });
    check('correction refused unless the case is returned (409)', notRet.status === 409, 'status=' + notRet.status);
    await fetch(B + '/api/admin/submissions/' + ref + '/status', { method: 'POST', headers: authH,
      body: JSON.stringify({ status: 'returned', note: 'send a clearer copy' }) });
    const retStatus = await fetch(B + '/api/submissions/' + ref + '/status').then(J);
    check('returned case lists its document fields publicly (keys only)',
      Array.isArray(retStatus.attachment_fields) && retStatus.attachment_fields.indexOf('id_number') < 0 && retStatus.data === undefined, JSON.stringify(retStatus.attachment_fields));
    const corr = await fetch(B + '/api/submissions/' + ref + '/corrections', { method: 'POST', headers: jsonHdr,
      body: JSON.stringify({ field: 'selfie_photo', file: PNG }) });
    const afterCorr = storeSingleton.getSubmission(ref);
    check('correction accepted: status processing, field points at corr1 file, original kept, audited',
      corr.status === 200 && afterCorr.status === 'processing' && afterCorr.data.selfie_photo === '@file:corr1_selfie_photo.png' &&
      afterCorr.attachments.some(function (a) { return a.endsWith('/selfie_photo.png'); }) && afterCorr.data._corrections.length === 1 &&
      storeSingleton.listAudit({ limit: 5000 }).some(function (r) { return r.action === 'correction' && r.ref_code === ref; }),
      'status=' + corr.status + ' ' + JSON.stringify([afterCorr.status, afterCorr.data.selfie_photo]));

    // 22. attachments are served only to a session, only by a safe name, and audited
    const attOk = await fetch(B + '/api/admin/submissions/' + ref + '/attachments/selfie_photo.png', { headers: authH });
    const attNoAuth = await fetch(B + '/api/admin/submissions/' + ref + '/attachments/selfie_photo.png');
    const attTrav = await fetch(B + '/api/admin/submissions/' + ref + '/attachments/' + encodeURIComponent('../../server.js'), { headers: authH });
    const attRows = storeSingleton.listAudit({ limit: 5000 }).filter((r) => r.action === 'attachment_view' && r.ref_code === ref);
    check('attachment served with session (200 image/png), 401 without, traversal name 404, audited',
      attOk.status === 200 && (attOk.headers.get('content-type') || '').indexOf('image/png') === 0 &&
      attNoAuth.status === 401 && attTrav.status === 404 && attRows.length >= 1,
      'ok=' + attOk.status + ' noauth=' + attNoAuth.status + ' trav=' + attTrav.status);

    // 23. deactivating / passwd revokes open sessions (store-level)
    const revUser = storeSingleton.createUser({ username: 'rev_' + RUN, display_name: 'Revoked User', role: 'viewer', password_hash: auth.hashPassword('Rev-pass-1'), active: true, created_at: Date.now() });
    const revTok = auth.createSession(storeSingleton, revUser.id);
    const nRev = storeSingleton.deleteSessionsForUser(revUser.id);
    const revRes = await fetch(B + '/api/admin/submissions', { headers: { 'Authorization': 'Bearer ' + revTok } });
    check('deleteSessionsForUser revokes open sessions (401 afterwards)', nRev >= 1 && revRes.status === 401, 'n=' + nRev + ' status=' + revRes.status);

    // attribution: identity comes from the session; a spoofed body field is ignored
    const aRef = 'ATTR-' + RUN;
    await fetch(B + '/api/submissions/' + aRef, { method: 'PUT', headers: jsonHdr,
      body: JSON.stringify({ data: { form_code: 'Fm-C-B20', id_number: 'A5', contact_number: '7715555' } }) });
    await fetch(B + '/api/admin/submissions/' + aRef + '/status', { method: 'POST', headers: authH,
      body: JSON.stringify({ status: 'processing', status_dv: 'ޕްރޮސެސް ކުރަނީ', note: 'n',
        changed_by_name: 'HACKER', changed_by: 9999 }) });   // spoof attempt
    const aFull = await fetch(B + '/api/admin/submissions/' + aRef, { headers: authH }).then(J);
    const lastH = aFull.history[aFull.history.length - 1];
    check('attribution: full-record history entry carries actor id+name from the session',
      lastH.changed_by === officer.id && lastH.changed_by_name === 'Adam Officer');
    check('attribution: spoofed changed_by / changed_by_name in the body is ignored',
      lastH.changed_by_name !== 'HACKER' && lastH.changed_by !== 9999);
    const aPub = await fetch(B + '/api/submissions/' + aRef + '/status').then(J);
    check('attribution: public status contains NO changed_by* anywhere (deep scan)',
      aPub.history.length >= 1 && JSON.stringify(aPub).indexOf('changed_by') === -1);

    // ===================== notifications outbox (spec 04, minimal) ==========
    await new Promise((r) => setTimeout(r, 150));   // notify() runs after the response
    const outboxLines = fs.existsSync(process.env.FC_OUTBOX_PATH)
      ? fs.readFileSync(process.env.FC_OUTBOX_PATH, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)) : [];
    const subMsg = outboxLines.find((m) => m.ref_code === aRef && m.event === 'submitted' && m.channel === 'sms');
    const stMsg = outboxLines.find((m) => m.ref_code === aRef && m.event === 'status_change' && m.status === 'processing');
    check('outbox: submit writes an SMS line to the number given (not delivered: no gateway configured)',
      !!subMsg && subMsg.to === '7715555' && subMsg.delivered === false && /no gateway/.test(subMsg.error || '') && subMsg.text_dv.indexOf(aRef) >= 0, JSON.stringify(subMsg));
    check('outbox: a status change writes a line carrying the new status and the note',
      !!stMsg && stMsg.note === 'n' && stMsg.status_dv === 'ޕްރޮސެސް ކުރަނީ' && stMsg.text_dv.indexOf('ޕްރޮސެސް') >= 0, JSON.stringify(stMsg));

    // ===================== staff accounts + export + events (handover) ======
    {
      const ADMIN = 'adm_' + RUN, ADMIN_PW = 'Admin-pass-1';
      storeSingleton.createUser({ username: ADMIN, display_name: 'Aminath Admin', role: 'admin', password_hash: auth.hashPassword(ADMIN_PW), active: true, created_at: Date.now() });
      _resetRateLimits();
      const aOk = await fetch(B + '/api/admin/login', { method: 'POST', headers: jsonHdr, body: loginBody(ADMIN, ADMIN_PW) }).then(J);
      const adminH = { 'Authorization': 'Bearer ' + aOk.token, 'Content-Type': 'application/json' };
      const asOfficer = await fetch(B + '/api/admin/users', { headers: authH });
      check('users: officer role refused (403)', asOfficer.status === 403, 'status=' + asOfficer.status);
      const lst = await fetch(B + '/api/admin/users', { headers: adminH }).then(J);
      check('users: admin lists accounts without password hashes', Array.isArray(lst.users) && lst.users.some((u) => u.username === OFFICER) && !JSON.stringify(lst).includes('password_hash'));
      const NEW = 'new_' + RUN;
      const bad = await fetch(B + '/api/admin/users', { method: 'POST', headers: adminH, body: JSON.stringify({ username: NEW, display_name: 'N', role: 'officer', password: 'short' }) });
      check('users: short password refused (400)', bad.status === 400, 'status=' + bad.status);
      const made = await fetch(B + '/api/admin/users', { method: 'POST', headers: adminH, body: JSON.stringify({ username: NEW, display_name: 'ނިއު އޮފިސަރ', role: 'officer', password: 'New-pass-123' }) }).then(J);
      check('users: account created (role, Dhivehi name kept)', made.user && made.user.role === 'officer' && made.user.display_name === 'ނިއު އޮފިސަރ', JSON.stringify(made));
      const dup = await fetch(B + '/api/admin/users', { method: 'POST', headers: adminH, body: JSON.stringify({ username: NEW, display_name: 'N', role: 'officer', password: 'New-pass-123' }) });
      check('users: duplicate username refused (409)', dup.status === 409, 'status=' + dup.status);
      _resetRateLimits();
      const nOk = await fetch(B + '/api/admin/login', { method: 'POST', headers: jsonHdr, body: loginBody(NEW, 'New-pass-123') }).then(J);
      check('users: the new account can log in', !!nOk.token);
      await fetch(B + '/api/admin/users/' + NEW + '/password', { method: 'POST', headers: adminH, body: JSON.stringify({ password: 'Other-pass-456' }) });
      const oldTok = await fetch(B + '/api/admin/submissions', { headers: { 'Authorization': 'Bearer ' + nOk.token } });
      _resetRateLimits();
      const reLogin = await fetch(B + '/api/admin/login', { method: 'POST', headers: jsonHdr, body: loginBody(NEW, 'Other-pass-456') }).then(J);
      check('users: password set → old session ended, new password works', oldTok.status === 401 && !!reLogin.token, 'old=' + oldTok.status);
      const self = await fetch(B + '/api/admin/users/' + ADMIN + '/active', { method: 'POST', headers: adminH, body: JSON.stringify({ active: false }) });
      check('users: an admin cannot deactivate itself (400)', self.status === 400, 'status=' + self.status);
      await fetch(B + '/api/admin/users/' + NEW + '/active', { method: 'POST', headers: adminH, body: JSON.stringify({ active: false }) });
      _resetRateLimits();
      const dead = await fetch(B + '/api/admin/login', { method: 'POST', headers: jsonHdr, body: loginBody(NEW, 'Other-pass-456') });
      const deadTok = await fetch(B + '/api/admin/submissions', { headers: { 'Authorization': 'Bearer ' + reLogin.token } });
      check('users: deactivated → login refused and open session ended', dead.status === 401 && deadTok.status === 401);
      const uAudit = await fetch(B + '/api/admin/audit?limit=50', { headers: adminH }).then(J);
      check('users: create / password / deactivate audited with the admin as actor',
        ['user_create', 'user_password', 'user_active'].every((a) => uAudit.audit.some((r) => r.action === a && r.actor_name === 'Aminath Admin')));

      const arcV = await fetch(B + '/api/admin/submissions/' + aRef + '/archive', { method: 'POST', headers: viewerH, body: JSON.stringify({ archived: true }) });
      check('archive: viewer refused (403)', arcV.status === 403, 'status=' + arcV.status);
      await fetch(B + '/api/admin/submissions/' + aRef + '/archive', { method: 'POST', headers: authH, body: JSON.stringify({ archived: true }) });
      const arcList = await fetch(B + '/api/admin/submissions', { headers: adminH }).then(J);
      const arcRow = arcList.submissions.find((r) => r.ref_code === aRef);
      check('archive: kept on the server, so every officer sees it archived', arcRow && typeof arcRow.archived_at === 'number', JSON.stringify(arcRow && arcRow.archived_at));
      await fetch(B + '/api/admin/submissions/' + aRef + '/archive', { method: 'POST', headers: authH, body: JSON.stringify({ archived: false }) });
      const resRow = (await fetch(B + '/api/admin/submissions', { headers: adminH }).then(J)).submissions.find((r) => r.ref_code === aRef);
      const arcAudit = (await fetch(B + '/api/admin/audit?ref=' + aRef + '&limit=50', { headers: adminH }).then(J)).audit;
      check('archive: restore clears it; both audited with the officer', resRow && resRow.archived_at === null && arcAudit.some((r) => r.action === 'archive' && r.actor_name === 'Adam Officer') && arcAudit.some((r) => r.action === 'restore'));
      const arcMissing = await fetch(B + '/api/admin/submissions/NO-SUCHCASE1/archive', { method: 'POST', headers: authH, body: JSON.stringify({ archived: true }) });
      check('archive: unknown case 404', arcMissing.status === 404, 'status=' + arcMissing.status);

      const exp = await fetch(B + '/api/admin/export?since=0&limit=2', { headers: authH }).then(J);
      check('export: full records oldest first, paged with next_since',
        Array.isArray(exp.submissions) && exp.submissions.length === 2 && exp.submissions[0].data && typeof exp.next_since === 'number' && exp.more === true, JSON.stringify({ n: exp.submissions && exp.submissions.length, more: exp.more }));
      const exp2 = await fetch(B + '/api/admin/export?since=' + exp.next_since + '&limit=500', { headers: authH }).then(J);
      check('export: the next page starts after next_since and does not repeat', exp2.submissions.every((r) => r.submitted_at > exp.next_since) && !exp2.submissions.some((r) => r.ref_code === exp.submissions[0].ref_code));
      const expViewer = await fetch(B + '/api/admin/export', { headers: viewerH });
      check('export: viewer refused (403)', expViewer.status === 403, 'status=' + expViewer.status);

      const evLines = fs.existsSync(process.env.FC_EVENT_LOG_PATH) ? fs.readFileSync(process.env.FC_EVENT_LOG_PATH, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)) : [];
      check('events: submitted and status_change logged for the case (no webhook → not delivered, no record copy in the log)',
        evLines.some((e) => e.event === 'submitted' && e.ref_code === aRef && e.delivered === false) && evLines.some((e) => e.event === 'status_change' && e.ref_code === aRef && e.actor && e.actor.name === 'Adam Officer') && !evLines.some((e) => e.record), 'lines=' + evLines.length);
    }

    // ===================== audit trail (spec 02) ===========================
    const aud = 'AUD-' + RUN;
    await fetch(B + '/api/submissions/' + aud, { method: 'PUT', headers: jsonHdr,
      body: JSON.stringify({ data: { form_code: 'Fm-C-B20', id_number: 'A6', contact_number: '7716666' } }) });
    for (const [st, dv] of [['processing', 'ޕްރޮސެސް ކުރަނީ'], ['approved', 'ފާސްކުރެވިފައި']]) {
      await fetch(B + '/api/admin/submissions/' + aud + '/status', { method: 'POST', headers: authH,
        body: JSON.stringify({ status: st, status_dv: dv }) });
    }
    const auditResp = await fetch(B + '/api/admin/audit?ref=' + aud, { headers: authH }).then(J);
    const changes = auditResp.audit.filter((r) => r.action === 'status_change');
    check('audit: one status_change row per mutation, newest-first via GET /api/admin/audit?ref=',
      changes.length === 2 && changes[0].details && JSON.parse(changes[0].details).to === 'approved', 'n=' + changes.length);

    const vAudit = await fetch(B + '/api/admin/audit?ref=' + aud, { headers: viewerH });
    check('audit: viewer blocked from the audit endpoint (403)', vAudit.status === 403);

    // no POST/PUT/DELETE route touches audit_log — with a VALID token → 404 (route
    // does not exist), proving the audit log has no mutation endpoint at all.
    let auditImmutable = true, aiInfo = '';
    for (const m of ['POST', 'PUT', 'DELETE']) {
      const r = await fetch(B + '/api/admin/audit', { method: m, headers: authH, body: '{}' });
      if (r.status !== 404) { auditImmutable = false; aiInfo = m + ' /audit -> ' + r.status; }
    }
    for (const m of ['DELETE', 'PUT']) {
      const r = await fetch(B + '/api/admin/audit/1', { method: m, headers: authH, body: '{}' });
      if (r.status !== 404) { auditImmutable = false; aiInfo = m + ' /audit/1 -> ' + r.status; }
    }
    check('audit: no POST/PUT/DELETE route touches the audit log (all 404)', auditImmutable, aiInfo);

    // ===================== rate limiting (spec 02) =========================
    _resetRateLimits();                                  // isolate the burst window
    const rateUser = 'rate_' + RUN;
    const rlStatuses = [];
    for (let i = 0; i < 6; i++) {
      const r = await fetch(B + '/api/admin/login', { method: 'POST', headers: jsonHdr, body: loginBody(rateUser, 'nope') });
      rlStatuses.push(r.status);
    }
    check('rate limit: first 5 logins allowed (401), 6th in the minute → 429',
      rlStatuses.slice(0, 5).every((s) => s === 401) && rlStatuses[5] === 429, rlStatuses.join(','));
    const rlRows = storeSingleton.listAudit({ limit: 5000 }).filter((r) => r.action === 'login_rate_limited');
    const rlMine = rlRows.find((r) => { try { return JSON.parse(r.details).username === rateUser; } catch (e) { return false; } });
    check('rate limit: the 429 is itself audited (login_rate_limited)', !!rlMine);

    // ===================== store-layer checks (unchanged) ==================

    // A. history ORDER preserved through the server: submit + 3 updates = 4, in order
    _resetRateLimits();                                  // clear the login burst so /status has headroom
    const hRef = 'HIST-' + Date.now().toString(36).toUpperCase();
    await fetch(B + '/api/submissions/' + hRef, { method: 'PUT', headers: jsonHdr,
      body: JSON.stringify({ data: { form_code: 'Fm-C-B20', id_number: 'A1', contact_number: '7711111' } }) });
    const steps = [['processing', 'ޕްރޮސެސް ކުރަނީ'], ['pending', 'މަޑުޖެހިފައި'], ['approved', 'ފާސްކުރެވިފައި']];
    for (const [st, dv] of steps) {
      await fetch(B + '/api/admin/submissions/' + hRef + '/status', { method: 'POST', headers: authH,
        body: JSON.stringify({ status: st, status_dv: dv, note: st }) });
    }
    const hist = (await fetch(B + '/api/submissions/' + hRef + '/status').then(J)).history;
    const order = hist.map((h) => h.status).join(',');
    check('store(' + STORE + '): history order preserved (submit + 3 updates = 4)',
      hist.length === 4 && order === 'submitted,processing,pending,approved', order);

    // B. persistence across restart: write, close store, reopen SAME location, read
    const persistLoc = STORE === 'sqlite' ? path.join(TMP, 'persist.db') : path.join(TMP, 'persist-json');
    const now = Date.now();
    const s1 = makeStore(STORE, persistLoc); s1.init();
    s1.putSubmission('PERSIST-1', { ref_code: 'PERSIST-1',
      data: { applicant_full_name: 'ފާތިމަތު ދެމިހުރި', form_code: 'Fm-C-B20' },
      status: 'submitted', status_dv: 'ހުށަހެޅިފައި', submitted_at: now,
      contact_number: '7712345', id_number: 'A234567', form_code: 'Fm-C-B20',
      attachments: ['uploads/PERSIST-1/selfie.png'], history: [] });
    s1.appendHistory('PERSIST-1', { status: 'submitted', status_dv: 'ހުށަހެޅިފައި', timestamp: now, note: '' });
    s1.appendHistory('PERSIST-1', { status: 'processing', status_dv: 'ޕްރޮސެސް ކުރަނީ', timestamp: now + 1, note: 'x' });
    s1.close();
    const s2 = makeStore(STORE, persistLoc); s2.init();
    const listed = s2.listSubmissions().find((r) => r.ref_code === 'PERSIST-1');
    check('store(' + STORE + '): submission persists across restart', !!listed);
    const p = s2.getSubmission('PERSIST-1');
    check('store(' + STORE + '): Dhivehi + attachments + history intact after restart',
      !!p && p.data.applicant_full_name === 'ފާތިމަތު ދެމިހުރި' && p.attachments[0] === 'uploads/PERSIST-1/selfie.png' &&
      p.history.length === 2 && p.history[0].status === 'submitted' && p.history[1].status === 'processing');
    s2.close();

    // C. expired-draft purge (lazy check aside — this is the sweep)
    const purgeLoc = STORE === 'sqlite' ? path.join(TMP, 'purge.db') : path.join(TMP, 'purge-json');
    const ps = makeStore(STORE, purgeLoc); ps.init();
    ps.putDraft('EXPIRED-1', { data: { x: 1 }, saved_at: now - 10000, expires_at: now - 1000 });
    ps.putDraft('FRESH-1', { data: { y: 2 }, saved_at: now, expires_at: now + 100000 });
    const purged = ps.purgeExpiredDrafts(now);
    check('store(' + STORE + '): expired draft purged, fresh kept',
      purged === 1 && ps.getDraft('EXPIRED-1') === null && !!ps.getDraft('FRESH-1'), 'purged=' + purged);
    ps.close();

    // D. json and sqlite return identical shapes for the same record (incl. attribution)
    const sj = makeStore('json', path.join(TMP, 'shape-json'));  sj.init();
    const sq = makeStore('sqlite', path.join(TMP, 'shape.db'));  sq.init();
    function shapeRecord() {
      return { ref_code: 'SHAPE-1', data: { a: 1, name: 'ފާތިމަތު' }, status: 'submitted',
        status_dv: 'ހުށަހެޅިފައި', submitted_at: 123456, contact_number: '7712345', id_number: 'A1',
        form_code: 'Fm-C-B20', attachments: ['uploads/SHAPE-1/selfie.png'], history: [] };
    }
    const h0 = { status: 'submitted', status_dv: 'ހުށަހެޅިފައި', timestamp: 123456, note: '' };
    sj.putSubmission('SHAPE-1', shapeRecord()); sj.appendHistory('SHAPE-1', h0);
    sq.putSubmission('SHAPE-1', shapeRecord()); sq.appendHistory('SHAPE-1', h0);
    const rj = sj.getSubmission('SHAPE-1'), rq = sq.getSubmission('SHAPE-1');
    const keysJ = Object.keys(rj).sort().join(','), keysQ = Object.keys(rq).sort().join(',');
    check('json/sqlite: identical submission field set', keysJ === keysQ, keysJ + '  vs  ' + keysQ);
    const hkJ = Object.keys(rj.history[0]).sort().join(','), hkQ = Object.keys(rq.history[0]).sort().join(',');
    check('json/sqlite: identical history-entry field set (incl. changed_by*)', hkJ === hkQ, hkJ + '  vs  ' + hkQ);
    check('json/sqlite: same values round-trip (Dhivehi, attachment, id, timestamp)',
      rj.data.name === rq.data.name && rj.attachments[0] === rq.attachments[0] &&
      rj.id_number === rq.id_number && rj.history[0].timestamp === rq.history[0].timestamp);

    // D2. auth-store parity: a user + session + audit row round-trip the same in both
    function seedAuth(s) {
      const u = s.createUser({ username: 'parity', display_name: 'Parity User', role: 'officer',
        password_hash: auth.hashPassword('Parity-pass-1'), active: true, created_at: 111 });
      const tok = auth.createSession(s, u.id);
      s.insertAudit({ at: 222, actor_user_id: u.id, actor_name: 'Parity User', action: 'status_change',
        ref_code: 'PAR-1', ip: '127.0.0.1', details: JSON.stringify({ from: 'submitted', to: 'approved' }) });
      return { u, tok };
    }
    const aj = seedAuth(sj), aq = seedAuth(sq);
    const ujKeys = Object.keys(sj.getUserByUsername('parity')).sort().join(',');
    const uqKeys = Object.keys(sq.getUserByUsername('parity')).sort().join(',');
    check('json/sqlite: identical user field set', ujKeys === uqKeys, ujKeys + '  vs  ' + uqKeys);
    check('json/sqlite: password verify + session resolve identically',
      auth.verifyPassword('Parity-pass-1', sj.getUserByUsername('parity').password_hash) &&
      auth.verifyPassword('Parity-pass-1', sq.getUserByUsername('parity').password_hash) &&
      !!sj.getSession(auth.sha256(aj.tok)) && !!sq.getSession(auth.sha256(aq.tok)));
    const ajAudit = sj.listAudit({ ref: 'PAR-1' }), aqAudit = sq.listAudit({ ref: 'PAR-1' });
    check('json/sqlite: audit row round-trips the same (ref filter, actor, details)',
      ajAudit.length === 1 && aqAudit.length === 1 &&
      ajAudit[0].actor_name === 'Parity User' && aqAudit[0].actor_name === 'Parity User' &&
      JSON.parse(ajAudit[0].details).to === 'approved' && JSON.parse(aqAudit[0].details).to === 'approved');
    sj.close(); sq.close();

    // E. migration idempotency: second boot on the same DB does not re-run or error.
    // user_version is now 2 (001-init + 002-auth).
    const migLoc = path.join(TMP, 'migrate.db');
    const m1 = makeStore('sqlite', migLoc); m1.init();
    const v1 = m1._userVersion();
    m1.putSubmission('MIG-1', { ref_code: 'MIG-1', data: {}, status: 'submitted', status_dv: 'x',
      submitted_at: now, contact_number: '', id_number: '', form_code: '', attachments: [], history: [] });
    m1.createUser({ username: 'mig', display_name: 'Mig', role: 'officer', password_hash: auth.hashPassword('Mig-pass-1'), active: true, created_at: now });
    m1.close();
    let reinitOk = true, err = '';
    const m2 = makeStore('sqlite', migLoc);
    try { m2.init(); } catch (e) { reinitOk = false; err = e.message; }
    const v2 = m2._userVersion();
    const stillThere = !!m2.getSubmission('MIG-1') && !!m2.getUserByUsername('mig');
    check('migration: second boot does not re-run or error (user_version stable at the latest migration)',
      reinitOk && v1 === 3 && v2 === 3 && stillThere, 'v1=' + v1 + ' v2=' + v2 + (err ? ' err=' + err : ''));
    m2.close();

  } catch (e) {
    check('threw: ' + e.message, false);
    console.error(e);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed  [store: ' + STORE + ']');
  server.close();
  cleanup();
  process.exit(fail ? 1 : 0);
})();
