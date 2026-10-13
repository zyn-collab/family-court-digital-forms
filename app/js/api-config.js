/* ===========================================================================
 * api-config.js — REAL-BACKEND data layer (drop-in replacement for
 * browser-store.js). It exposes the exact same window.DataStore
 * interface, but talks to the reference backend
 * over HTTP instead of localStorage.
 *
 * NOT loaded by any page yet — the app still uses browser-store.js
 * (localStorage). To switch a page to the backend, change its script tag:
 *     <script src="js/browser-store.js"></script>
 *   →  <script src="js/api-config.js"></script>
 * and set the API base URL once (before init), e.g.:
 * <script>window.FC_API_BASE = 'https://api.familycourt.gov.mv';</script>
 *
 * The method signatures, return shapes, and behaviours match browser-store.js
 * exactly, so the rest of the app needs no changes.
 * =========================================================================== */

window.DataStore = (function () {
  function base() { return (window.FC_API_BASE || 'http://localhost:4000').replace(/\/$/, ''); }
  // Token lives in sessionStorage (dies with the tab), NOT localStorage — a
  // staff session should not persist on a shared machine after the tab closes.
  function adminToken() { return sessionStorage.getItem('fc_admin_token') || ''; }
  function clearToken() {
    sessionStorage.removeItem('fc_admin_token');
    sessionStorage.removeItem('fc_admin_name');
    sessionStorage.removeItem('fc_admin_role');
  }

  async function api(method, pathname, body, admin) {
    const headers = { 'Content-Type': 'application/json' };
    if (admin) headers['Authorization'] = 'Bearer ' + adminToken();
    const res = await fetch(base() + pathname, {
      method: method,
      headers: headers,
      body: body == null ? undefined : JSON.stringify(body)
    });
    if (res.status === 404) return { _notFound: true };
    if (res.status === 401) {
      // Session invalid/expired/deactivated — drop the token so the UI falls
      // back to the login view instead of retrying with a dead token.
      clearToken();
      throw new Error('unauthorized');
    }
    if (res.status === 429) throw new Error('rate limited');
    if (!res.ok) {
      let detail = '';
      try { detail = (JSON.parse(await res.text()) || {}).error || ''; } catch (e2) { /* no body */ }
      const err = new Error('API ' + res.status); err.detail = detail; throw err;
    }
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }

  // ── same interface as browser-store.js ──────────────────────────────────
  function init() { /* nothing to init for HTTP; kept for signature parity */ }
  function isOnline() { return true; }
  function getDb() { return null; }

  // Server is authoritative for uniqueness, but the app generates codes
  // client-side today; keep that behaviour (crypto RNG, 8 chars).
  function generateRefCode(prefix) {
    prefix = prefix || 'VS';
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    const buf = new Uint32Array(8);
    (window.crypto || {}).getRandomValues ? window.crypto.getRandomValues(buf) : buf.fill(Math.floor(Math.random() * 1e9));
    for (let i = 0; i < 8; i++) code += chars.charAt(buf[i] % chars.length);
    return prefix + '-' + code;
  }

  // The server issues the reference number (unique across drafts and submissions).
  // If it cannot be reached, a local random one is used so the form still opens.
  async function newRefCode(prefix, formCode) {
    try {
      const r = await api('POST', '/api/refs', { prefix: prefix || 'FC', form_code: formCode || undefined });
      if (r && r.ref_code) return r.ref_code;
    } catch (e) { console.warn('reference number: server unavailable, using a local one', e); }
    return generateRefCode(prefix);
  }
  async function saveDraft(ref, formData) {
    await api('PUT', '/api/drafts/' + encodeURIComponent(ref), { data: formData });
    return ref;
  }
  async function loadDraft(ref) {
    const r = await api('GET', '/api/drafts/' + encodeURIComponent(ref));
    return r._notFound ? null : r.data;
  }
  async function deleteDraft(ref) {
    await api('DELETE', '/api/drafts/' + encodeURIComponent(ref));
  }

  async function saveSubmission(ref, submissionData) {
    await api('PUT', '/api/submissions/' + encodeURIComponent(ref), { data: submissionData });
    return ref;
  }
  // A returned case: send one replacement document (field key + data URI)
  async function submitCorrection(ref, field, dataUri) {
    const r = await api('POST', '/api/submissions/' + encodeURIComponent(ref) + '/corrections', { field: field, file: dataUri });
    return !!(r && r.ok);
  }
  async function getSubmissionStatus(ref) {
    const r = await api('GET', '/api/submissions/' + encodeURIComponent(ref) + '/status');
    return r._notFound ? null : r;
  }

  // ── admin (require a session; call adminLogin first) ───────────────────────
  // Per-staff login (spec 02). On success the raw token + display name/role are
  // kept in sessionStorage; identity for every mutation is derived server-side
  // from the session, never sent by this client.
  async function adminLogin(username, password) {
    const r = await api('POST', '/api/admin/login', { username: username, password: password });
    if (r && r.token) {
      sessionStorage.setItem('fc_admin_token', r.token);
      sessionStorage.setItem('fc_admin_name', r.display_name || '');
      sessionStorage.setItem('fc_admin_role', r.role || '');
      return true;
    }
    return false;
  }
  async function adminLogout() {
    try { await api('POST', '/api/admin/logout', {}, true); } catch (e) { /* ignore */ }
    clearToken();
    return true;
  }
  function adminName() { return sessionStorage.getItem('fc_admin_name') || ''; }
  function adminRole() { return sessionStorage.getItem('fc_admin_role') || ''; }
  function isAdminLoggedIn() { return !!adminToken(); }
  async function listSubmissions() {
    const r = await api('GET', '/api/admin/submissions', null, true);
    return (r && r.submissions) || [];
  }
  async function getSubmissionFull(ref) {
    const r = await api('GET', '/api/admin/submissions/' + encodeURIComponent(ref), null, true);
    return r._notFound ? null : r;
  }
  async function updateSubmissionStatus(ref, status, statusDv, note) {
    await api('POST', '/api/admin/submissions/' + encodeURIComponent(ref) + '/status',
      { status: status, status_dv: statusDv, note: note || '' }, true);
    return true;
  }
  // A stored attachment ("@file:<name>" in the record) as a Blob, fetched with the
  // session token (a plain <img src> cannot carry the Authorization header).
  async function fetchAttachment(ref, name) {
    const res = await fetch(base() + '/api/admin/submissions/' + encodeURIComponent(ref) + '/attachments/' + encodeURIComponent(name),
      { headers: { 'Authorization': 'Bearer ' + adminToken() } });
    if (res.status === 401) { clearToken(); throw new Error('unauthorized'); }
    if (!res.ok) throw new Error('API ' + res.status);
    return res.blob();
  }
  // Audit trail for a case (officer+): "who did what on case X", newest first.
  async function getAudit(ref, limit) {
    const q = [];
    if (ref) q.push('ref=' + encodeURIComponent(ref));
    if (limit) q.push('limit=' + encodeURIComponent(limit));
    const r = await api('GET', '/api/admin/audit' + (q.length ? '?' + q.join('&') : ''), null, true);
    return (r && r.audit) || [];
  }

  // staff accounts (admin role) — the admin page's "Staff accounts" panel
  async function listUsers() { const r = await api('GET', '/api/admin/users', null, true); return (r && r.users) || []; }
  async function createUser(u) { return api('POST', '/api/admin/users', u, true); }
  async function setUserActive(username, active) { return api('POST', '/api/admin/users/' + encodeURIComponent(username) + '/active', { active: active }, true); }
  async function setUserPassword(username, password) { return api('POST', '/api/admin/users/' + encodeURIComponent(username) + '/password', { password: password }, true); }

  return {
    init, isOnline, getDb, generateRefCode, newRefCode,
    listUsers, createUser, setUserActive, setUserPassword,
    saveDraft, loadDraft, deleteDraft,
    saveSubmission, getSubmissionStatus, updateSubmissionStatus, listSubmissions,
    getSubmissionFull, submitCorrection,
    // admin/session helpers the admin page uses
    adminLogin, adminLogout, isAdminLoggedIn, adminName, adminRole, getAudit, fetchAttachment
  };
})();
