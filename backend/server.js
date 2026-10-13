/* ===========================================================================
 * Family Court digital forms — REFERENCE backend
 * ---------------------------------------------------------------------------
 * A runnable, zero-dependency reference implementation of the API the frontend
 * needs. It shows the whole flow end to end (drafts, submissions, status,
 * admin, attachment storage) so the Court's IT team has a concrete contract to
 * build the production service against.
 *
 * It is a REFERENCE server, but the security-critical parts are real (spec 02):
 *   - staff auth is per-account with scrypt-hashed passwords and DB-backed
 *     sessions (sha256(token) stored, never the raw token); identity for every
 *     mutation is derived from the session server-side (see auth.js)
 *   - every admin mutation and every failed/rate-limited login is written to an
 *     append-only audit trail
 *   - storage is JSON files under ./data by default (FC_STORE=sqlite for the
 *     node:sqlite store); object storage / encryption at rest are the host's job
 *   - CORS defaults to "*" for easy demoing (production: set FC_ALLOW_ORIGIN);
 *     HTTPS is the host/reverse-proxy's job (set FC_TRUST_PROXY=1 behind one)
 *
 * Accounts are created with the CLI only — there is no signup/user-management
 * HTTP endpoint:  node user-cli.js add <username> "<Display Name>" <role>
 *
 * Run:  node server.js           (defaults: port 4000, FC_STORE=json)
 *       FC_PORT=4000 FC_ALLOW_ORIGIN=https://yoursite FC_TRUST_PROXY=1 node server.js
 * =========================================================================== */

'use strict';
require('./env');                               // backend/.env, if present
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const auth = require('./auth');
const notifier = require('./notify');          // outbox + SMS/email webhook
const events = require('./events');            // every case change to the Court's own system (webhook + log)

const PORT = Number(process.env.FC_PORT || 4000);
// Cross-site access. Unset = the site and the API share one address (the backend serving
// app/, or a proxy in front of both), so no cross-site headers are sent at all. Set it only
// when the site is served from a different address than the API.
const ALLOW_ORIGIN = process.env.FC_ALLOW_ORIGIN || (process.env.FC_DEV === '1' ? '*' : '');
// The backend serves the site (app/) itself unless FC_SERVE_APP=0, so one command runs the
// whole system; the site's API address then points at this same server.
const APP_DIR = path.resolve(process.env.FC_APP_DIR || path.join(__dirname, '..', 'app'));
const SERVE_APP = process.env.FC_SERVE_APP !== '0' && fs.existsSync(path.join(APP_DIR, 'form.html'));
const TRUST_PROXY = process.env.FC_TRUST_PROXY === '1';   // trust X-Forwarded-For
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;      // matches the frontend
const MAX_BODY = 25 * 1024 * 1024;                 // 25 MB (room for photos)

// Every ref reaching the store or the filesystem must match this. The app
// generates XX-XXXXXXXX (2-letter prefix + 8 chars); this is deliberately a
// little looser but still a SINGLE hyphen-separated alphanumeric token — no
// slashes, dots or quotes can pass, so a ref can never escape the uploads/<ref>
// path join. Case-insensitive because the app always sends uppercase but the
// test suite mints some refs from Date.now().toString(36) (lowercase).
const REF_RE = /^[A-Z0-9]{1,6}-[A-Z0-9]{4,16}$/i;
// The same alphabet the pages use (no 0/O/1/I): 8 symbols from 32 → 1.1 × 10^12 numbers
const REF_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function newRefCode(prefix) {
  let code = '';
  for (let i = 0; i < 8; i++) code += REF_ALPHABET.charAt(crypto.randomInt(REF_ALPHABET.length));
  return prefix + '-' + code;
}

// Uploads root. Every path written or
// served below is resolved and checked to stay under this directory.
const UPLOAD_DIR = path.resolve(process.env.FC_UPLOADS_DIR || path.join(__dirname, 'uploads'));
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const MAX_FILE_BYTES = Math.max(1, Number(process.env.FC_MAX_FILE_MB || 10)) * 1024 * 1024;
const DEV = process.env.FC_DEV === '1';

// The only statuses a case can have; the Dhivehi label is derived HERE, never
// taken from the request (it is shown to citizens on the status page).
const STATUSES = {
  submitted: 'ހުށަހެޅިފައި', processing: 'ޕްރޮސެސް ކުރަނީ', pending: 'ޕެންޑިންގް',
  approved: 'ޤަބޫލު ކުރެވިފައި', rejected: 'ބޭރު ކުރެވިފައި',
  returned: 'އިޞްލާޙަށް ފޮނުވިފައި', completed: 'ނިމިފައި'
};
const NOTE_MAX = 500;
const MIN_PASSWORD = 8;                           // same rule as user-cli.js
const KEY_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,119}$/;   // form field keys
const FORM_CODE_RE = /^[A-Za-z0-9_+-]{1,60}$/;           // "Fm-C-B20" or "A+B" (combined drafts)
const FILE_NAME_RE = /^[a-z0-9_]{1,60}\.(png|jpg|gif|webp|pdf|doc|docx)$/;
const MAX_KEYS = 3000, MAX_STRING = 20000, MAX_ARRAY = 500;

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

// Shape check on a citizen payload: a plain object of scalar/array-of-scalar
// values under sane size caps. Data URIs (uploads) are checked by size here and
// by content in persistAttachments.
function validateData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'data must be an object';
  const keys = Object.keys(data);
  if (keys.length > MAX_KEYS) return 'too many fields';
  for (const k of keys) {
    if (!KEY_RE.test(k)) return 'bad field key';
    const v = data[k];
    if (v == null || typeof v === 'number' || typeof v === 'boolean') continue;
    if (typeof v === 'string') {
      if (v.startsWith('data:')) { if (v.length > MAX_FILE_BYTES * 1.4 + 200) return 'file too large: ' + k; }
      else if (v.length > MAX_STRING) return 'value too long: ' + k;
      continue;
    }
    if (Array.isArray(v)) {
      if (v.length > MAX_ARRAY) return 'array too long: ' + k;
      for (const x of v) {
        if (!(x == null || typeof x === 'number' || typeof x === 'boolean' || (typeof x === 'string' && x.length <= 2000))) return 'bad array value: ' + k;
      }
      continue;
    }
    // the wizard's location answers: { applicant_residence: { area, atoll, island }, ... }
    if (k === 'jurisdiction_answers' && v && typeof v === 'object') {
      const qs = Object.keys(v);
      if (qs.length > 10) return 'bad value type: ' + k;
      for (const q of qs) {
        const a = v[q];
        if (!KEY_RE.test(q) || !a || typeof a !== 'object' || Array.isArray(a)) return 'bad value type: ' + k;
        const parts = Object.keys(a);
        if (parts.length > 8) return 'bad value type: ' + k;
        for (const pk of parts) {
          if (!KEY_RE.test(pk) || !(a[pk] == null || (typeof a[pk] === 'string' && a[pk].length <= 200))) return 'bad value type: ' + k;
        }
      }
      continue;
    }
    return 'bad value type: ' + k;
  }
  if (data.form_code && !FORM_CODE_RE.test(data.form_code)) return 'bad form_code';
  return null;
}

// ── storage: the store is selected via FC_STORE and hides behind a small
// synchronous interface, so nothing below this line knows or cares whether the
// data lives in JSON files or SQLite. Default stays "json" (the reference file
// store) so nothing changes for anyone running the server today; FC_STORE=sqlite
// opts into the node:sqlite store. ──────────────────────────────────────────
const STORE_KIND = process.env.FC_STORE === 'sqlite' ? 'sqlite' : 'json';
const store = require(STORE_KIND === 'sqlite' ? './store-sqlite' : './store-json');
store.init();

// Draft TTL: keep the lazy check on read (below) and also sweep expired drafts
// at boot and once per hour. unref() so the timer never holds the process (or
// the test runner) open.
store.purgeExpiredDrafts(Date.now());
if (store.purgeExpiredSessions) store.purgeExpiredSessions(Date.now());
const purgeTimer = setInterval(function () {
  try { store.purgeExpiredDrafts(Date.now()); if (store.purgeExpiredSessions) store.purgeExpiredSessions(Date.now()); }
  catch (e) { console.error('[purge] ' + e.message); }
}, 60 * 60 * 1000);
purgeTimer.unref();

// ── in-memory per-IP rate limiting (no dependency): sliding window. Login is
// 5/min, public status is 20/min. This is per-process, so
// behind multiple instances put the real limit at the load balancer too. ─────
const rateBuckets = new Map();                       // key -> [timestamps]
// Per-connection limits. The figures written at each call below are a strict reference;
// FC_RATE_SCALE multiplies them (default 20, so a whole office behind one connection is
// never held back: about 100 logins, 400 status lookups and 2400 draft saves a minute).
// FC_RATE_SCALE=0 turns per-connection limits off. The per-account login limit
// (10 failed attempts per username in 10 minutes) is never scaled or turned off.
const RATE_SCALE = (function () {
  const v = Number(process.env.FC_RATE_SCALE);
  return process.env.FC_RATE_SCALE === undefined || process.env.FC_RATE_SCALE === '' || !Number.isFinite(v) || v < 0 ? 20 : v;
})();
function rateAllow(key, limit, windowMs) {
  if (key.indexOf('login-user:') !== 0) {
    if (RATE_SCALE === 0) return true;
    limit = Math.max(1, Math.round(limit * RATE_SCALE));
  }
  const now = Date.now();
  const arr = (rateBuckets.get(key) || []).filter(function (t) { return t > now - windowMs; });
  arr.push(now);
  rateBuckets.set(key, arr);
  return arr.length <= limit;                        // true = allowed
}
function _resetRateLimits() { rateBuckets.clear(); }  // test-only hook
// idle IPs are dropped so the map cannot grow without bound
const sweepTimer = setInterval(function () {
  const cutoff = Date.now() - 60 * 60 * 1000;
  rateBuckets.forEach(function (arr, key) {
    if (!arr.length || arr[arr.length - 1] < cutoff) rateBuckets.delete(key);
  });
}, 10 * 60 * 1000);
sweepTimer.unref();

// Client IP for rate-limiting/audit. Behind a reverse proxy the socket address
// is the proxy's, so honor the FIRST X-Forwarded-For hop — but ONLY when
// FC_TRUST_PROXY=1 (otherwise a client could spoof the header to dodge limits).
function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
  }
  return (req.socket && req.socket.remoteAddress) || '';
}

// Append one row to the audit trail. Never throws into the request path — an
// audit failure is logged but does not break the response.
function audit(fields) {
  try {
    store.insertAudit({
      at: Date.now(),
      actor_user_id: fields.actor_user_id == null ? null : fields.actor_user_id,
      actor_name: fields.actor_name == null ? null : fields.actor_name,
      action: fields.action,
      ref_code: fields.ref_code == null ? null : fields.ref_code,
      ip: fields.ip == null ? null : fields.ip,
      details: fields.details == null ? null
        : (typeof fields.details === 'string' ? fields.details : JSON.stringify(fields.details))
    });
  } catch (e) { console.error('[audit] ' + e.message); }
}

// ── attachment extraction: pull data: URIs onto disk under uploads/<ref>/ ───
// The file type is decided from the bytes, never from the data-URI's own claim.
function sniffExt(buf) {
  const b = buf;
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'png';
  if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpg';
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif';
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (b.length >= 4 && b.toString('ascii', 0, 4) === '%PDF') return 'pdf';
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04) return 'docx';   // OOXML zip
  if (b.length >= 4 && b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0) return 'doc';    // OLE2
  return null;
}
const CONTENT_TYPES = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

// Decode every data: URI in the payload, check size and real type, write the files
// under uploads/<ref>/ with a derived filename, and replace the value in the stored
// data with "@file:<name>" so base64 lives on disk only. All-or-nothing: a rejected
// file leaves nothing on disk. Returns { files, data, rejected }.
function persistAttachments(ref, data) {
  const dir = path.resolve(UPLOAD_DIR, ref);
  if (!dir.startsWith(UPLOAD_DIR + path.sep)) return { files: [], data: data, rejected: { field: 'ref', reason: 'bad ref' } };
  const pending = [];
  const cleaned = Object.assign({}, data);
  for (const key of Object.keys(data || {})) {
    const v = data[key];
    if (typeof v !== 'string' || !v.startsWith('data:')) continue;
    const m = /^data:([^;,]*);base64,([A-Za-z0-9+/=\s]+)$/.exec(v);
    if (!m) return { files: [], data: data, rejected: { field: key, reason: 'bad file encoding' } };
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length) return { files: [], data: data, rejected: { field: key, reason: 'empty file' } };
    if (buf.length > MAX_FILE_BYTES) return { files: [], data: data, rejected: { field: key, reason: 'file too large' } };
    const ext = sniffExt(buf);
    if (!ext) return { files: [], data: data, rejected: { field: key, reason: 'file type not allowed' } };
    const base = key.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 60) || 'file';
    let fname = base + '.' + ext, n = 2;
    while (pending.some(function (p) { return p.fname === fname; })) fname = base + '_' + (n++) + '.' + ext;
    const full = path.resolve(dir, fname);
    if (!full.startsWith(dir + path.sep) || !FILE_NAME_RE.test(fname)) return { files: [], data: data, rejected: { field: key, reason: 'bad file name' } };
    pending.push({ key: key, fname: fname, full: full, buf: buf });
  }
  const files = [];
  if (pending.length) fs.mkdirSync(dir, { recursive: true });
  pending.forEach(function (p) {
    fs.writeFileSync(p.full, p.buf);
    files.push('uploads/' + ref + '/' + p.fname);
    cleaned[p.key] = '@file:' + p.fname;
  });
  return { files: files, data: cleaned, rejected: null };
}
// Path of a stored attachment, or null if the name is not one we could have written
// or the resolved path leaves the ref's own folder.
function attachmentPath(ref, fname) {
  if (!FILE_NAME_RE.test(fname)) return null;
  const dir = path.resolve(UPLOAD_DIR, ref);
  const full = path.resolve(dir, fname);
  if (!dir.startsWith(UPLOAD_DIR + path.sep) || !full.startsWith(dir + path.sep)) return null;
  return fs.existsSync(full) ? full : null;
}

// ── helpers ─────────────────────────────────────────────────────────────────
function send(res, code, obj) {
  const body = obj == null ? '' : JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders(),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',                 // every response may carry personal data
    'Referrer-Policy': 'no-referrer',
    'Vary': 'Origin'
  });
  res.end(body);
}
function corsHeaders() {
  return ALLOW_ORIGIN ? { 'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS' } : {};
}
// ── the site (app/) ─────────────────────────────────────────────────────────
const STATIC_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.webp': 'image/webp', '.gif': 'image/gif' };
function serveApp(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (e) { res.writeHead(400); res.end(); return; }
  if (rel === '/' || rel === '') rel = '/index.html';
  const headers = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-cache' };
  // the site's one setting: when the backend serves the site, the API is this same address
  if (rel === '/js/site-config.js') {
    res.writeHead(200, Object.assign({ 'Content-Type': STATIC_TYPES['.js'] }, headers));
    res.end('window.FC_API_BASE = window.location.origin;\n');
    return;
  }
  const full = path.resolve(APP_DIR, '.' + rel);
  if (full !== APP_DIR && !full.startsWith(APP_DIR + path.sep)) { res.writeHead(404); res.end('not found'); return; }
  fs.stat(full, function (err, st) {
    if (err || !st.isFile()) { res.writeHead(404, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, headers)); res.end('not found'); return; }
    res.writeHead(200, Object.assign({ 'Content-Type': STATIC_TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size }, headers));
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(full).pipe(res);
  });
}
function requestId() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
function readBody(req) {
  return new Promise(function (resolve, reject) {
    let size = 0; const chunks = [];
    req.on('data', function (c) {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}
// Public status must NEVER expose who changed a status — citizens see updates as
// coming from "the Court", never a named officer. Rebuild each history entry with
// only the four public fields, so changed_by / changed_by_name cannot leak even
// if the store carries them (a deep scan of this output finds no changed_by*).
function publicStatus(rec) {
  const history = (rec.history || []).map(function (h) {
    return { status: h.status, status_dv: h.status_dv, timestamp: h.timestamp, note: h.note };
  });
  const out = {
    ref_code: rec.ref_code, status: rec.status, status_dv: rec.status_dv,
    submitted_at: rec.submitted_at, form_code: rec.form_code, history: history
  };
  // a returned case lists WHICH documents exist (field keys only, never contents) so
  // the status page can offer "replace this document"
  if (rec.status === 'returned') {
    out.attachment_fields = Object.keys(rec.data || {}).filter(function (k) {
      const v = rec.data[k];
      return typeof v === 'string' && (v.startsWith('@file:') || v.startsWith('data:')) && k !== 'selfie_photo' && k !== 'declarant_signature' && !k.startsWith('_');
    });
  }
  return out;
}

// ── router ──────────────────────────────────────────────────────────────────
const server = http.createServer(async function (req, res) {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);   // e.g. ['api','drafts','VS-XXXX']
  const method = req.method;

  if (method === 'OPTIONS') return send(res, 204, null);
  if (parts[0] !== 'api') {
    if (SERVE_APP && (method === 'GET' || method === 'HEAD')) return serveApp(req, res, url.pathname);
    return send(res, 404, { error: 'not found' });
  }

  try {
    // ── ref validation (one shared check, closes the path-traversal) ──
    // Any route that takes a ref does so from parts[2] (drafts/submissions) or
    // parts[3] (admin/submissions). Reject a malformed ref once, here, before it
    // reaches the store or persistAttachments' path.join.
    let refSeg = null;
    if (parts[1] === 'drafts' && parts[2]) refSeg = parts[2];
    else if (parts[1] === 'submissions' && parts[2]) refSeg = parts[2];
    else if (parts[1] === 'admin' && parts[2] === 'submissions' && parts[3]) refSeg = parts[3];
    if (refSeg !== null && !REF_RE.test(decodeURIComponent(refSeg))) {
      return send(res, 400, { error: 'bad ref' });
    }

    // ── health (public, no data): for the process manager / load balancer ──
    if (parts[1] === 'health' && parts[2] === undefined && method === 'GET') {
      return send(res, 200, { ok: true, store: STORE_KIND, uptime_s: Math.round(process.uptime()) });
    }

    // ── reference numbers (public) ── the server hands out the number so no two
    // forms can ever share one: it is drawn at random and checked against every
    // draft and every submission before it is reserved (as an empty draft).
    if (parts[1] === 'refs' && parts[2] === undefined && method === 'POST') {
      if (!rateAllow('refs:' + clientIp(req), 60, 60 * 1000)) return send(res, 429, { error: 'too many requests' });
      const body = await readBody(req);
      const prefix = String((body && body.prefix) || 'FC').toUpperCase();
      if (!/^[A-Z0-9]{1,6}$/.test(prefix)) return send(res, 400, { error: 'bad prefix' });
      const form_code = body && body.form_code;
      if (form_code && !FORM_CODE_RE.test(String(form_code))) return send(res, 400, { error: 'bad form_code' });
      let ref = null;
      for (let i = 0; i < 20 && !ref; i++) {
        const c = newRefCode(prefix);
        if (!store.getDraft(c) && !store.getSubmission(c)) ref = c;
      }
      if (!ref) return send(res, 503, { error: 'could not issue a reference number' });
      store.putDraft(ref, { data: form_code ? { form_code: String(form_code) } : {}, saved_at: Date.now(), expires_at: Date.now() + DRAFT_TTL_MS });
      return send(res, 200, { ref_code: ref });
    }

    // ── drafts (public) ── a draft is personal data keyed only by its reference;
    // every draft route is rate-limited so codes cannot be tried at line rate.
    if (parts[1] === 'drafts' && parts[2]) {
      const ref = decodeURIComponent(parts[2]);
      if (!rateAllow('drafts:' + clientIp(req), 120, 60 * 1000)) return send(res, 429, { error: 'too many requests' });
      if (method === 'PUT') {
        // a number that has been submitted is closed: a draft may never land on it
        // (a repeat number, a stale tab, or a guess) — the filing belongs to whoever submitted it
        if (store.getSubmission(ref)) return send(res, 409, { error: 'already submitted' });
        const body = await readBody(req);
        const bad = validateData(body.data);
        if (bad) return send(res, 400, { error: bad });
        store.putDraft(ref, { data: body.data, saved_at: Date.now(), expires_at: Date.now() + DRAFT_TTL_MS });
        return send(res, 200, { ref_code: ref });
      }
      if (method === 'GET') {
        const rec = store.getDraft(ref);
        if (!rec) return send(res, 404, { error: 'not found' });
        if (rec.expires_at && rec.expires_at < Date.now()) {
          store.deleteDraft(ref);
          return send(res, 404, { error: 'expired' });
        }
        return send(res, 200, { data: rec.data });
      }
      if (method === 'DELETE') {
        store.deleteDraft(ref);
        return send(res, 200, { ok: true });
      }
    }

    // ── submit (public) ──
    if (parts[1] === 'submissions' && parts[2] && parts[3] === undefined && method === 'PUT') {
      const ref = decodeURIComponent(parts[2]);
      // Create-only: a public submit may never MUTATE an existing submission
      // (that path belongs to authenticated staff alone). Re-submitting an
      // existing ref is rejected rather than silently overwritten.
      if (store.getSubmission(ref)) return send(res, 409, { error: 'already submitted' });
      if (!rateAllow('submit:' + clientIp(req), 20, 60 * 1000)) return send(res, 429, { error: 'too many requests' });
      const body = await readBody(req);
      const data = body.data || {};
      const bad = validateData(data);
      if (bad) return send(res, 400, { error: bad });
      // Re-check AFTER the body was read: two concurrent submits for one ref both
      // passed the check above; nothing awaits between here and the write.
      if (store.getSubmission(ref)) return send(res, 409, { error: 'already submitted' });
      const att = persistAttachments(ref, data);      // decode, sniff, cap, write, strip
      if (att.rejected) return send(res, 400, { error: att.rejected.reason, field: att.rejected.field });
      const now = Date.now();
      store.putSubmission(ref, {
        ref_code: ref, data: att.data,
        status: 'submitted', status_dv: STATUSES.submitted,
        submitted_at: now,
        contact_number: typeof data.contact_number === 'string' ? data.contact_number.slice(0, 40) : '',
        id_number: typeof data.id_number === 'string' ? data.id_number.slice(0, 40) : '',
        form_code: data.form_code || '', attachments: att.files,
        history: []
      });
      // First timeline entry (kept in submission_history for sqlite; pushed onto
      // the record for json) — appendHistory owns history in both stores.
      store.appendHistory(ref, { status: 'submitted', status_dv: STATUSES.submitted, timestamp: now, note: '' });
      store.deleteDraft(ref);                         // draft becomes a submission
      audit({ action: 'submit', ref_code: ref, ip: clientIp(req), details: { form_code: data.form_code || '', files: att.files.length } });
      // the receipt by SMS/email: outbox always, gateway when configured; never blocks the filing
      notifier.notify(Object.assign({ event: 'submitted', ref_code: ref, form_code: data.form_code || '',
        status: 'submitted', status_dv: STATUSES.submitted }, notifier.contactsOf({ data: att.data, contact_number: typeof data.contact_number === 'string' ? data.contact_number.slice(0, 40) : '' })))
        .catch(function () { /* recorded in the outbox */ });
      events.emit('submitted', store.getSubmission(ref), null).catch(function () { /* logged */ });
      return send(res, 200, { ref_code: ref, attachments: att.files });
    }

    // ── correction (public, ref-gated, rate-limited): when the Court has returned a
    // case for correction, the citizen may send one replacement document for a field
    // without reopening the whole form. The case goes back to "processing"; the
    // original file stays on disk; the record notes what came in and when. ──
    if (parts[1] === 'submissions' && parts[2] && parts[3] === 'corrections' && parts[4] === undefined && method === 'POST') {
      const ref = decodeURIComponent(parts[2]);
      if (!rateAllow('correction:' + clientIp(req), 10, 60 * 1000)) return send(res, 429, { error: 'too many requests' });
      const rec = store.getSubmission(ref);
      if (!rec) return send(res, 404, { error: 'not found' });
      if (rec.status !== 'returned') return send(res, 409, { error: 'not awaiting correction' });
      const body = await readBody(req);
      const field = typeof body.field === 'string' ? body.field : '';
      if (!KEY_RE.test(field) || field.startsWith('_')) return send(res, 400, { error: 'bad field' });
      if (typeof body.file !== 'string' || !body.file.startsWith('data:')) return send(res, 400, { error: 'file required' });
      const corrections = (rec.data && Array.isArray(rec.data._corrections)) ? rec.data._corrections : [];
      const tmpKey = 'corr' + (corrections.length + 1) + '_' + field;
      const one = {}; one[tmpKey] = body.file;
      const att = persistAttachments(ref, one);
      if (att.rejected) return send(res, 400, { error: att.rejected.reason, field: field });
      const now = Date.now();
      rec.data = rec.data || {};
      rec.data[field] = att.data[tmpKey];                       // the field now points at the new file
      rec.data._corrections = corrections.concat([{ field: field, file: att.data[tmpKey].slice(6), at: now }]);
      rec.attachments = (rec.attachments || []).concat(att.files);
      rec.status = 'processing'; rec.status_dv = STATUSES.processing;
      store.putSubmission(ref, rec);
      store.appendHistory(ref, { status: 'processing', status_dv: STATUSES.processing, timestamp: now, note: '' });
      audit({ action: 'correction', ref_code: ref, ip: clientIp(req), details: { field: field, file: att.data[tmpKey].slice(6) } });
      events.emit('correction', store.getSubmission(ref), null).catch(function () { /* logged */ });
      return send(res, 200, { ok: true, status: 'processing', status_dv: STATUSES.processing });
    }

    // ── public status (no full data) ──
    if (parts[1] === 'submissions' && parts[2] && parts[3] === 'status' && method === 'GET') {
      if (!rateAllow('status:' + clientIp(req), 20, 60 * 1000)) {
        return send(res, 429, { error: 'too many requests' });
      }
      const ref = decodeURIComponent(parts[2]);
      const rec = store.getSubmission(ref);
      if (!rec) return send(res, 404, { error: 'not found' });
      return send(res, 200, publicStatus(rec));
    }

    // ── admin login (public; per-staff account, DB-backed session) ──
    if (parts[1] === 'admin' && parts[2] === 'login' && method === 'POST') {
      const ip = clientIp(req);
      const body = await readBody(req);
      const username = typeof body.username === 'string' ? body.username : '';
      // Rate-limit FIRST (before any credential work), and audit the 429 itself.
      if (!rateAllow('login:' + ip, 5, 60 * 1000) ||
          (username && !rateAllow('login-user:' + username.toLowerCase(), 10, 10 * 60 * 1000))) {
        audit({ action: 'login_rate_limited', ip: ip, details: { username: username } });
        return send(res, 429, { error: 'too many attempts' });
      }
      const user = username ? store.getUserByUsername(username) : null;
      const ok = !!(user && user.active && auth.verifyPassword(body.password || '', user.password_hash));
      if (!ok) {
        // Same generic 401 for unknown user / wrong password / deactivated —
        // never reveal which. Audit the attempted USERNAME only, never a password.
        audit({ action: 'login_fail', ip: ip, details: { username: username } });
        return send(res, 401, { error: 'invalid credentials' });
      }
      const token = auth.createSession(store, user.id);
      audit({ action: 'login_ok', actor_user_id: user.id, actor_name: user.display_name,
              ip: ip, details: { username: username } });
      return send(res, 200, { token: token, display_name: user.display_name, role: user.role });
    }

    // ── admin: everything below requires a valid, unexpired session belonging
    // to an ACTIVE staff user. Identity is derived here, server-side. ──────────
    if (parts[1] === 'admin') {
      const user = auth.sessionUser(store, req);
      if (!user) return send(res, 401, { error: 'unauthorized' });
      const ip = clientIp(req);

      // logout: destroy this session
      if (parts[2] === 'logout' && parts[3] === undefined && method === 'POST') {
        const tok = auth.bearerToken(req);
        if (tok) store.deleteSession(auth.sha256(tok));
        audit({ action: 'logout', actor_user_id: user.id, actor_name: user.display_name, ip: ip });
        return send(res, 200, { ok: true });
      }

      // list submissions (viewer+). Adds the last actor's name so the admin list
      // can show a "last changed by" column (internal visibility only).
      if (parts[2] === 'submissions' && parts[3] === undefined && method === 'GET') {
        const list = store.listSubmissions().map(function (r) {
          const hist = r.history || [];
          let lastBy = '';
          for (let i = hist.length - 1; i >= 0; i--) {
            if (hist[i].changed_by_name) { lastBy = hist[i].changed_by_name; break; }
          }
          return { ref_code: r.ref_code, status: r.status, status_dv: r.status_dv,
                   submitted_at: r.submitted_at, form_code: r.form_code,
                   contact_number: r.contact_number || '', id_number: r.id_number || '',
                   changed_by_name: lastBy, archived_at: r.archived_at || null };
        });
        return send(res, 200, { submissions: list });
      }

      // audit trail (officer+): "who did what on case X", newest first.
      if (parts[2] === 'audit' && parts[3] === undefined && method === 'GET') {
        if (!auth.requireRole(user, 'officer')) return send(res, 403, { error: 'forbidden' });
        const refQ = url.searchParams.get('ref') || null;
        let limit = parseInt(url.searchParams.get('limit'), 10);
        if (!Number.isFinite(limit) || limit <= 0) limit = 100;
        if (limit > 1000) limit = 1000;
        return send(res, 200, { audit: store.listAudit({ ref: refQ, limit: limit }) });
      }

      // full submission (viewer+); reading a full record is itself audited.
      if (parts[2] === 'submissions' && parts[3] && parts[4] === undefined && method === 'GET') {
        const ref = decodeURIComponent(parts[3]);
        const rec = store.getSubmission(ref);
        if (!rec) return send(res, 404, { error: 'not found' });
        audit({ action: 'view_full', actor_user_id: user.id, actor_name: user.display_name,
                ref_code: ref, ip: ip });
        return send(res, 200, rec);
      }

      // stored attachment (viewer+): streamed from the uploads root, audited.
      // The name must be one persistAttachments could have written and must
      // resolve inside uploads/<ref>/ — there is no public route into uploads/.
      if (parts[2] === 'submissions' && parts[3] && parts[4] === 'attachments' && parts[5] && parts[6] === undefined && method === 'GET') {
        const ref = decodeURIComponent(parts[3]);
        const fname = decodeURIComponent(parts[5]);
        if (!store.getSubmission(ref)) return send(res, 404, { error: 'not found' });
        const full = attachmentPath(ref, fname);
        if (!full) return send(res, 404, { error: 'not found' });
        audit({ action: 'attachment_view', actor_user_id: user.id, actor_name: user.display_name,
                ref_code: ref, ip: ip, details: { file: fname } });
        const ext = fname.slice(fname.lastIndexOf('.') + 1);
        res.writeHead(200, {
          'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream',
          'Content-Disposition': 'inline; filename="' + fname + '"',
          ...corsHeaders(),
          'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Vary': 'Origin'
        });
        fs.createReadStream(full).pipe(res);
        return;
      }

      // update status (officer+): THE only path that mutates an existing
      // submission. Attribution is taken from the SESSION, never the request body;
      // the status must be one of STATUSES and its Dhivehi label is derived here.
      // archive / restore a case (officer+). Nothing is deleted: the case leaves the
      // default worklist for every officer and returns with "Show archived".
      if (parts[2] === 'submissions' && parts[3] && parts[4] === 'archive' && parts[5] === undefined && method === 'POST') {
        if (!auth.requireRole(user, 'officer')) return send(res, 403, { error: 'forbidden' });
        const ref = decodeURIComponent(parts[3]);
        const body = await readBody(req);
        const archived = body.archived !== false;
        if (!store.setArchived(ref, archived ? Date.now() : null)) return send(res, 404, { error: 'not found' });
        audit({ action: archived ? 'archive' : 'restore', actor_user_id: user.id, actor_name: user.display_name, ref_code: ref, ip: ip });
        return send(res, 200, { ok: true, archived: archived });
      }

      if (parts[2] === 'submissions' && parts[3] && parts[4] === 'status' && method === 'POST') {
        if (!auth.requireRole(user, 'officer')) return send(res, 403, { error: 'forbidden' });
        const ref = decodeURIComponent(parts[3]);
        const rec = store.getSubmission(ref);
        if (!rec) return send(res, 404, { error: 'not found' });
        const body = await readBody(req);
        if (typeof body.status !== 'string' || !Object.prototype.hasOwnProperty.call(STATUSES, body.status)) {
          return send(res, 400, { error: 'bad status' });
        }
        const note = typeof body.note === 'string' ? body.note.slice(0, NOTE_MAX) : '';
        const from = rec.status;
        const statusDv = STATUSES[body.status];
        store.updateStatus(ref, body.status, statusDv, {
          status: body.status, status_dv: statusDv, timestamp: Date.now(), note: note,
          changed_by: user.id,                         // FROM SESSION — body ignored
          changed_by_name: user.display_name
        });
        audit({ action: 'status_change', actor_user_id: user.id, actor_name: user.display_name,
                ref_code: ref, ip: ip, details: { from: from, to: body.status, note: note } });
        notifier.notify(Object.assign({ event: 'status_change', ref_code: ref, form_code: rec.form_code || '',
          status: body.status, status_dv: statusDv, note: note }, notifier.contactsOf(rec)))
          .catch(function () { /* recorded in the outbox */ });
        events.emit('status_change', store.getSubmission(ref), { id: user.id, name: user.display_name }).catch(function () { /* logged */ });
        return send(res, 200, { ok: true });
      }

      // ── export for the Court's own systems (officer+): full records, oldest first,
      //    page with ?since=<submitted_at of the last record received>&limit=<=500 ──
      if (parts[2] === 'export' && parts[3] === undefined && method === 'GET') {
        if (!auth.requireRole(user, 'officer')) return send(res, 403, { error: 'forbidden' });
        const since = parseInt(url.searchParams.get('since'), 10) || 0;
        let limit = parseInt(url.searchParams.get('limit'), 10);
        if (!Number.isFinite(limit) || limit <= 0) limit = 100;
        if (limit > 500) limit = 500;
        const all = store.listSubmissions()
          .filter(function (r) { return (r.submitted_at || 0) > since; })
          .sort(function (a, b) { return (a.submitted_at || 0) - (b.submitted_at || 0); });
        const pageRecs = all.slice(0, limit).map(function (r) { return store.getSubmission(r.ref_code) || r; });
        audit({ action: 'export', actor_user_id: user.id, actor_name: user.display_name, ip: ip, details: { since: since, count: pageRecs.length } });
        return send(res, 200, { submissions: pageRecs, next_since: pageRecs.length ? pageRecs[pageRecs.length - 1].submitted_at : since, more: all.length > pageRecs.length });
      }

      // ── staff accounts (admin role): what user-cli.js does, from the admin page ──
      if (parts[2] === 'users') {
        if (!auth.requireRole(user, 'admin')) return send(res, 403, { error: 'forbidden' });
        const pub = function (u) { return { id: u.id, username: u.username, display_name: u.display_name, role: u.role, active: !!u.active, created_at: u.created_at }; };
        if (parts[3] === undefined && method === 'GET') return send(res, 200, { users: store.listUsers().map(pub) });
        if (parts[3] === undefined && method === 'POST') {
          const body = await readBody(req);
          const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
          const displayName = typeof body.display_name === 'string' ? body.display_name.trim().slice(0, 80) : '';
          const role = body.role;
          const password = typeof body.password === 'string' ? body.password : '';
          if (!/^[a-z0-9._-]{3,40}$/.test(username)) return send(res, 400, { error: 'username: 3-40 letters, digits, . _ -' });
          if (!displayName) return send(res, 400, { error: 'display name required' });
          if (['viewer', 'officer', 'admin'].indexOf(role) < 0) return send(res, 400, { error: 'role must be viewer, officer or admin' });
          if (password.length < MIN_PASSWORD) return send(res, 400, { error: 'password: at least ' + MIN_PASSWORD + ' characters' });
          if (store.getUserByUsername(username)) return send(res, 409, { error: 'username already exists' });
          const created = store.createUser({ username: username, display_name: displayName, role: role,
            password_hash: auth.hashPassword(password), active: true, created_at: Date.now() });
          audit({ action: 'user_create', actor_user_id: user.id, actor_name: user.display_name, ip: ip, details: { username: username, role: role } });
          return send(res, 200, { user: pub(created) });
        }
        const target = parts[3] ? decodeURIComponent(parts[3]) : '';
        const tu = target ? store.getUserByUsername(target) : null;
        if (!tu) return send(res, 404, { error: 'not found' });
        if (parts[4] === 'active' && parts[5] === undefined && method === 'POST') {
          const body = await readBody(req);
          const active = body.active === true;
          if (!active && tu.id === user.id) return send(res, 400, { error: 'an account cannot deactivate itself' });
          store.setUserActive(tu.username, active);
          const revoked = (!active && store.deleteSessionsForUser) ? store.deleteSessionsForUser(tu.id) : 0;
          audit({ action: 'user_active', actor_user_id: user.id, actor_name: user.display_name, ip: ip, details: { username: tu.username, active: active, sessions_revoked: revoked } });
          return send(res, 200, { ok: true });
        }
        if (parts[4] === 'password' && parts[5] === undefined && method === 'POST') {
          const body = await readBody(req);
          const password = typeof body.password === 'string' ? body.password : '';
          if (password.length < MIN_PASSWORD) return send(res, 400, { error: 'password: at least ' + MIN_PASSWORD + ' characters' });
          store.setUserPassword(tu.username, auth.hashPassword(password));
          const revoked = store.deleteSessionsForUser ? store.deleteSessionsForUser(tu.id) : 0;
          audit({ action: 'user_password', actor_user_id: user.id, actor_name: user.display_name, ip: ip, details: { username: tu.username, sessions_revoked: revoked } });
          return send(res, 200, { ok: true });
        }
        return send(res, 404, { error: 'not found' });
      }

      // Any other /api/admin/* method+path (e.g. POST/PUT/DELETE on audit) has no
      // handler: fall through to 404. There is deliberately NO route that
      // updates or deletes an audit row.
      return send(res, 404, { error: 'not found' });
    }

    return send(res, 404, { error: 'not found' });
  } catch (e) {
    // Known client errors keep their message; anything else is logged with a
    // request id and answered generically (no SQL text, paths or stack traces leave
    // the server).
    if (e.message === 'payload too large') return send(res, 413, { error: 'payload too large' });
    if (e.message === 'bad json') return send(res, 400, { error: 'bad json' });
    if (e.status) return send(res, e.status, { error: e.message });
    const id = requestId();
    console.error('[' + id + '] ' + method + ' ' + url.pathname + ': ' + (e && e.stack ? e.stack : e));
    return send(res, 500, { error: 'server error', request_id: id });
  }
});

if (require.main === module) {
  if (ALLOW_ORIGIN === '*' && !DEV) {
    console.error("FC_ALLOW_ORIGIN=* would let every website call this API. Set the site's address, or leave it unset when the site and the API share one address.");
    process.exit(1);
  }
  server.listen(PORT, function () {
    console.log('Family Court reference backend on http://localhost:' + PORT);
    console.log('  store:   ' + STORE_KIND +
      (STORE_KIND === 'sqlite'
        ? ' (' + (process.env.FC_DB_PATH || 'data/familycourt.db') + ')'
        : ' (' + (process.env.FC_DATA_DIR || 'data') + '/*.json)'));
    console.log('  uploads: ' + UPLOAD_DIR);
    if (SERVE_APP) console.log('  site:    http://localhost:' + PORT + '/   admin: http://localhost:' + PORT + '/admin.html');
    console.log('  cross-site access: ' + (ALLOW_ORIGIN || 'none (site and API on one address)'));
  });
}
module.exports = { server, _resetRateLimits };
