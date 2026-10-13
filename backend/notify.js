'use strict';
/*
 * Notification outbox + gateway hook.
 *
 * The Court's SMS/email gateway is not known yet, so this module does two things:
 *   1. appends every notification to an outbox file (FC_DATA_DIR/outbox.jsonl), so
 *      nothing is lost while a gateway is not configured, and IT can replay it;
 *   2. if FC_SMS_WEBHOOK / FC_EMAIL_WEBHOOK are set, POSTs the same JSON there
 *      (one request per message, bearer FC_WEBHOOK_TOKEN if set). A failed POST is
 *      recorded in the outbox line ("delivered": false, "error") and never breaks
 *      the filing or the status change that caused it.
 *
 * Message shape (what the webhook receives):
 *   { "id", "channel": "sms"|"email", "to", "event": "submitted"|"status_change",
 *     "ref_code", "form_code", "status", "status_dv", "note", "text_dv", "created_at" }
 *
 * Who is notified: the number/email the person gave on the notification page
 * (sms_phone with its country code → data.contact_number; data.notify_email).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');

const DATA_DIR = path.resolve(process.env.FC_DATA_DIR || path.join(__dirname, 'data'));
const OUTBOX = process.env.FC_OUTBOX_PATH || path.join(DATA_DIR, 'outbox.jsonl');
const SMS_WEBHOOK = process.env.FC_SMS_WEBHOOK || '';
const EMAIL_WEBHOOK = process.env.FC_EMAIL_WEBHOOK || '';
const TOKEN = process.env.FC_WEBHOOK_TOKEN || '';
const SITE = (process.env.FC_PUBLIC_SITE || '').replace(/\/$/, '');

// Dhivehi texts
function textFor(ev) {
  const where = SITE ? ' ' + SITE + '/status.html?ref=' + ev.ref_code : '';
  if (ev.event === 'submitted') {
    return 'ފެމިލީ ކޯޓު: ތިޔަ ފޯމު ލިބިއްޖެ. ރިފަރެންސް ނަންބަރު: ' + ev.ref_code + '.' + where;
  }
  return 'ފެމިލީ ކޯޓު: ރިފަރެންސް ނަންބަރު ' + ev.ref_code + ' ގެ ޙާލަތު: ' + (ev.status_dv || ev.status) + '.' +
    (ev.note ? ' ' + ev.note : '') + where;
}

function appendOutbox(line) {
  try {
    fs.mkdirSync(path.dirname(OUTBOX), { recursive: true });
    fs.appendFileSync(OUTBOX, JSON.stringify(line) + '\n');
  } catch (e) { /* the outbox is best-effort; the audit log holds the event */ }
}

async function post(url, msg) {
  const headers = { 'Content-Type': 'application/json' };
  if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
  const ctrl = new AbortController();
  const t = setTimeout(function () { ctrl.abort(); }, 8000);
  try {
    const r = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(msg), signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return null;
  } catch (e) {
    return String(e && e.message || e);
  } finally { clearTimeout(t); }
}

/**
 * ev = { event, ref_code, form_code, status, status_dv, note, contact_number, notify_email }
 * Returns a promise that resolves when the outbox lines are written (webhooks awaited).
 */
async function notify(ev) {
  const targets = [];
  if (ev.contact_number) targets.push({ channel: 'sms', to: ev.contact_number, url: SMS_WEBHOOK });
  if (ev.notify_email) targets.push({ channel: 'email', to: ev.notify_email, url: EMAIL_WEBHOOK });
  const out = [];
  for (const t of targets) {
    const msg = {
      id: crypto.randomUUID(), channel: t.channel, to: t.to, event: ev.event,
      ref_code: ev.ref_code, form_code: ev.form_code || '', status: ev.status || '',
      status_dv: ev.status_dv || '', note: ev.note || '', text_dv: textFor(ev), created_at: Date.now()
    };
    let error = t.url ? await post(t.url, msg) : 'no gateway configured';
    const line = Object.assign({}, msg, { delivered: !error, error: error || undefined });
    appendOutbox(line);
    out.push(line);
  }
  return out;
}

/** Contact details from a submission record (what the person typed on the notification page). */
function contactsOf(rec) {
  const d = (rec && rec.data) || {};
  return {
    contact_number: (rec && rec.contact_number) || (typeof d.contact_number === 'string' ? d.contact_number : ''),
    notify_email: typeof d.notify_email === 'string' ? d.notify_email.slice(0, 200) : ''
  };
}

module.exports = { notify: notify, contactsOf: contactsOf, OUTBOX: OUTBOX, textFor: textFor };
