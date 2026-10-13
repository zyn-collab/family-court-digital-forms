'use strict';
/*
 * Sample filings for a TEST installation, so admin-side testers have cases to work
 * with before anyone has filed through the public forms.
 *
 *   node seed-sample.js <site or API address> [per-form count] [officer username] [password]
 *   node seed-sample.js http://localhost:4000 2 officer1 '<password>'
 *
 * Each filing is built from the form's own definition (app/specs/<form>.json): every
 * question that applies is answered, list questions with one of their real options,
 * tables with two rows, every upload with a small image. Filings go in through the
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
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const H = { 'Content-Type': 'application/json' };

const NAMES = ['ޓެސްޓް ފާޠިމަތު ޙަސަން', 'ޓެސްޓް އަޙްމަދު ޝަރީފް', 'ޓެސްޓް މަރިޔަމް ނާޒިމާ', 'ޓެސްޓް އިބްރާހީމް ރަޝީދު', 'ޓެސްޓް ޢާއިޝަތު ނަސީމާ', 'ޓެސްޓް މުޙައްމަދު ޢަލީ'];
const ISLANDS = [['HA', 'ބާރަށް', 'ހއ.'], ['K', 'ތިލަފުށި', 'ކ.'], ['S', 'ހިތަދޫ', 'ސ.'], ['GDh', 'ތިނަދޫ', 'ގދ.']];
const HOUSES = ['ނޫރާނީވިލާ', 'ގުލްޝަނުގެ', 'ސީބްރީޒް', 'ހަނދުވަރީގެ'];
const SENTENCE = 'ޓެސްޓް ބަޔާން: މި މައްސަލަ ހުށަހަޅަނީ ޓެސްޓް ކުރުމުގެ ބޭނުމަށް.';
const STATUS_PLAN = [['processing', 'ލިޔެކިޔުން ބަލަމުން'], ['pending', 'ހެކިން ގެނައުމަށް'], ['returned', 'އައިޑީ ކާޑުގެ ފޮޓޯ ސާފެއް ނޫން'], ['approved', 'ބަލައިގަނެވިއްޖެ'], ['completed', 'މައްސަލަ ނިމިއްޖެ'], [null, '']];

let seq = 0;
const pick = (arr) => arr[seq % arr.length];
const pad = (n) => String(n).padStart(2, '0');
const idNo = () => 'A' + String(100000 + ((seq * 7919) % 899999));
const phone = () => '7' + String(100000 + ((seq * 104729) % 899999));
const dob = () => pad(1 + seq % 27) + '/' + pad(1 + seq % 12) + '/' + (1975 + seq % 20);

function opts(f) { return (f.options || []).filter((o) => o && o.value !== '' && o.value != null); }
function holds(rule, d) {
  if (!rule) return true;
  if (rule.all) return rule.all.every((r) => holds(r, d));
  if (rule.any) return rule.any.some((r) => holds(r, d));
  const v = d[rule.field];
  const has = (x) => Array.isArray(v) ? v.indexOf(x) >= 0 : v === x;
  switch (rule.op) {
    case 'eq': return has(rule.value);
    case 'ne': return !has(rule.value);
    case 'in': return (rule.values || []).some(has);
    case 'not_in': return !(rule.values || []).some(has);
    case 'gt': return Number(v) > Number(rule.value);
    case 'gte': return Number(v) >= Number(rule.value);
    case 'filled': return v != null && v !== '' && !(Array.isArray(v) && !v.length);
    default: return true;
  }
}
function address(d, k) {
  const [atoll, island, short] = pick(ISLANDS); const house = pick(HOUSES);
  Object.assign(d, { [k + '_atoll']: atoll, [k + '_island']: island, [k + '_detail']: house, [k + '_country']: '', [k]: house + '، ' + island + '، ' + short });
}
function value(f, k, d) {
  const t = f.type, o = opts(f);
  if (/full_name$|_name$/.test(k) && (t === 'text' || !t)) return pick(NAMES);
  if (/id_number$/.test(k)) { d[k + '_kind'] = 'id'; return idNo(); }
  switch (t) {
    case 'text': return /case_number$/.test(k) ? '0' + (100 + seq) + '/FC/2026' : 'ޓެސްޓް';
    case 'textarea': return SENTENCE;
    case 'number': return f.validation && f.validation.max != null && f.validation.max < 2 ? String(f.validation.max) : '2';
    case 'date': return dob();
    case 'tel': d[k + '_cc'] = '+960'; return phone();
    case 'email': return 'test' + seq + '@example.com';
    case 'radio': case 'select': return o.length ? o[seq % o.length].value : '';
    case 'checkbox': return o.length ? [o[0].value] : [];
    case 'file': case 'file_attachment': case 'id_photo': return PNG;
    default: return undefined;
  }
}

function buildFiling(spec) {
  const d = { form_code: spec.form_code };
  for (const step of spec.steps || []) {
    if (step.type === 'review' || step.type === 'payment' || step.audience === 'staff_only') continue;
    if (step.visible_when && !holds(step.visible_when, d)) continue;
    if (step.type === 'submitting_party') { d.submitting_party = 'party'; continue; }
    if (step.type === 'declaration') {
      Object.assign(d, { declarant_name: d.applicant_full_name || pick(NAMES), declarant_date: '13/10/2026', declarant_signature: PNG, selfie_photo: PNG });
      continue;
    }
    if (step.module === 'instructions') { d.contact_phone = phone(); d.contact_phone_cc = '+960'; }
    for (const f of step.fields || []) {
      if (!f.key || !holds(f.visible_when, d)) continue;
      if (f.type === 'address') { address(d, f.key); continue; }
      if (f.type === 'derived_age') { d[f.key] = String(30 + seq % 15); continue; }
      if (f.type === 'composite_group') { for (const sf of f.subfields || []) { const v = value(sf, sf.key, d); if (v !== undefined) d[sf.key] = v; } continue; }
      if (f.type === 'dynamic_table') {
        const rows = 2;
        if (f.count_field) d[f.count_field] = String(rows);
        for (let i = 1; i <= rows; i++) for (const c of f.columns || []) {
          const ck = f.key + '_' + i + '_' + c.key;
          if (c.type === 'address') { address(d, ck); continue; }
          const v = value(c, ck, d); if (v !== undefined) d[ck] = v;
        }
        continue;
      }
      if (f.type === 'attachments_checklist') { d[f.key || 'attachments'] = []; continue; }
      const v = value(f, f.key, d);
      if (v !== undefined && !(f.key in d)) d[f.key] = v;
    }
  }
  d.sms_phone = phone(); d.sms_phone_cc = '+960'; d.notify_email = 'test' + seq + '@example.com';
  d.id_number = d.applicant_id_number || d.appellant_id_number || '';
  d.contact_number = d.sms_phone_cc + ' ' + d.sms_phone;
  d.contact_email = d.notify_email;
  return d;
}

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
