'use strict';
/*
 * Outbound events for the Court's own systems (case management, archive, BI).
 *
 * When FC_EVENT_WEBHOOK is set, every change to a case is POSTed there as JSON:
 *   { "event": "submitted" | "status_change" | "correction",
 *     "at": 1760000000000,
 *     "ref_code": "VK-UV9WB2PQ", "form_code": "Fm-C-B20",
 *     "status": "processing", "status_dv": "…",
 *     "actor": { "id": 3, "name": "Aishath Ahmed" } | null,
 *     "record": { …the full submission record: data (answers keyed by field key,
 *                 files as "@file:<name>" markers), attachments, history… },
 *     "attachments": [ { "name": "applicant_id_document.jpg",
 *                        "path": "/api/admin/submissions/VK-UV9WB2PQ/attachments/applicant_id_document.jpg" } ] }
 *
 * The receiver fetches each attachment from the path above with a staff bearer
 * token (or reads it from FC_UPLOADS_DIR/<ref>/ on the same host). A 2xx answer
 * is success; anything else is written to the event log with the error and the
 * request that caused the event is never failed. Every event is also appended to
 * FC_EVENT_LOG_PATH (default FC_DATA_DIR/events.jsonl) whether or not a webhook is
 * set, so the Court's system can be back-filled with `GET /api/admin/export`.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');

const DATA_DIR = path.resolve(process.env.FC_DATA_DIR || path.join(__dirname, 'data'));
const LOG = process.env.FC_EVENT_LOG_PATH || path.join(DATA_DIR, 'events.jsonl');
const WEBHOOK = process.env.FC_EVENT_WEBHOOK || '';
const TOKEN = process.env.FC_WEBHOOK_TOKEN || '';

function appendLog(line) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, JSON.stringify(line) + '\n');
  } catch (e) { /* best effort */ }
}

async function post(msg) {
  if (!WEBHOOK) return 'no webhook configured';
  const headers = { 'Content-Type': 'application/json' };
  if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
  const ctrl = new AbortController();
  const t = setTimeout(function () { ctrl.abort(); }, 8000);
  try {
    const r = await fetch(WEBHOOK, { method: 'POST', headers: headers, body: JSON.stringify(msg), signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return null;
  } catch (e) {
    return String(e && e.message || e);
  } finally { clearTimeout(t); }
}

/** rec: the full submission record; actor: {id, name} or null. Resolves after the log line is written. */
async function emit(event, rec, actor) {
  if (!rec) return null;
  const ref = rec.ref_code;
  const msg = {
    id: crypto.randomUUID(), event: event, at: Date.now(),
    ref_code: ref, form_code: rec.form_code || '', status: rec.status || '', status_dv: rec.status_dv || '',
    actor: actor || null,
    record: rec,
    attachments: (rec.attachments || []).map(function (name) {
      return { name: name, path: '/api/admin/submissions/' + encodeURIComponent(ref) + '/attachments/' + encodeURIComponent(name) };
    })
  };
  const error = await post(msg);
  // the log keeps the envelope without the record (the record is in the store); delivery result beside it
  appendLog({ id: msg.id, event: event, at: msg.at, ref_code: ref, form_code: msg.form_code, status: msg.status,
              actor: msg.actor, delivered: !error, error: error || undefined });
  return msg;
}

module.exports = { emit: emit, LOG: LOG };
