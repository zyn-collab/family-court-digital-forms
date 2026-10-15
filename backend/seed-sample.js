'use strict';
/*
 * Sample filings for a TEST installation, so admin-side testers have cases to work
 * with before anyone has filed through the public forms.
 *
 *   node seed-sample.js <site or API address> [per-form count] [officer username] [password]
 *   node seed-sample.js http://localhost:4000 2 officer1 '<password>'
 *
 * Each filing is built from the form's own definition (app/specs/<form>.json) by
 * app/js/sample-filings.js: every question that applies is answered, list questions
 * with one of their real options, tables with two rows, every upload with a small image. Filings go in through the
 * public API exactly as a citizen's would. With an officer account, the filings are
 * then spread over the statuses (processing, pending, returned, approved, completed)
 * with a note each, so the worklist looks like a working week.
 *
 * Never run this against the production installation: every record it creates is a
 * real case in the database. Every applicant name it writes starts with ޓެސްޓް.
 */
const fs = require('fs');
const path = require('path');

const BASE = (process.argv[2] || 'http://localhost:4000').replace(/\/$/, '');
const PER_FORM = Math.max(1, parseInt(process.argv[3], 10) || 1);
const OFFICER = process.argv[4] || '';
const PASSWORD = process.argv[5] || '';
const SPEC_DIR = path.join(__dirname, '..', 'app', 'specs');
const H = { 'Content-Type': 'application/json' };

const SampleFilings = require('../app/js/sample-filings.js');   // shared with the admin page's demonstration mode
const STATUS_PLAN = SampleFilings.STATUS_PLAN;
let seq = 0;
const buildFiling = (spec) => SampleFilings.build(spec, seq);

(async () => {
  const health = await fetch(BASE + '/api/health').then((r) => r.json()).catch(() => null);
  if (!health || !health.ok) { console.error('No backend answering at ' + BASE + '/api/health'); process.exit(1); }
  let token = null;
  if (OFFICER) {
    const l = await fetch(BASE + '/api/admin/login', { method: 'POST', headers: H, body: JSON.stringify({ username: OFFICER, password: PASSWORD }) }).then((r) => r.json());
    if (!l.token) { console.error('Officer login failed: ' + JSON.stringify(l)); process.exit(1); }
    token = l.token;
  }
  const files = fs.readdirSync(SPEC_DIR).filter((f) => /^Fm-C-.*\.json$/.test(f)).sort();
  let made = 0, failed = 0;
  for (const file of files) {
    const spec = JSON.parse(fs.readFileSync(path.join(SPEC_DIR, file), 'utf8'));
    for (let n = 0; n < PER_FORM; n++) {
      seq++;
      const issued = await fetch(BASE + '/api/refs', { method: 'POST', headers: H, body: JSON.stringify({ prefix: spec.ref_prefix || 'FC', form_code: spec.form_code }) }).then((r) => r.json());
      const ref = issued.ref_code;
      const data = buildFiling(spec);
      data.ref_code = ref;
      const res = await fetch(BASE + '/api/submissions/' + ref, { method: 'PUT', headers: H, body: JSON.stringify({ data: data }) });
      if (res.status !== 200) { failed++; console.log('FAIL ' + spec.form_code + ' ' + ref + ' HTTP ' + res.status + ' ' + (await res.text()).slice(0, 120)); continue; }
      made++;
      let st = '';
      const plan = STATUS_PLAN[seq % STATUS_PLAN.length];
      if (token && plan[0]) {
        await fetch(BASE + '/api/admin/submissions/' + ref + '/status', { method: 'POST', headers: Object.assign({ Authorization: 'Bearer ' + token }, H), body: JSON.stringify({ status: plan[0], note: plan[1] }) });
        st = ' → ' + plan[0];
      }
      console.log('ok   ' + spec.form_code.padEnd(10) + ref + '  ' + Object.keys(data).length + ' fields' + st);
    }
  }
  console.log('\n' + made + ' sample filing(s) created' + (failed ? ', ' + failed + ' failed' : '') + ' at ' + BASE);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
