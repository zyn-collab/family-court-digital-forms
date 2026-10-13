/* ===========================================================================
 * store-json.js — JSON-file store (the default / dev / demo store)
 * ---------------------------------------------------------------------------
 * The original file store from server.js, extracted verbatim behind the store
 * interface so the reference server behaves EXACTLY as before when FC_STORE is
 * unset or "json". Objects keyed by ref code (drafts/submissions), users keyed
 * by id, sessions keyed by token hash — all loaded once at init(), persisted
 * with write-temp-then-rename on every write. The audit log is an APPEND-ONLY
 * JSON-lines file (fs.appendFileSync), never rewritten whole.
 *
 * Interface (all synchronous, identical to store-sqlite.js):
 *   init() / close()
 *   getDraft / putDraft / deleteDraft / purgeExpiredDrafts
 *   getSubmission / putSubmission / listSubmissions / appendHistory
 *   getUserByUsername / getUserById / createUser / listUsers /
 * setUserActive / setUserPassword
 * createSession / getSession / touchSession / deleteSession
 * insertAudit / listAudit
 *
 * Exports a ready singleton (so `const store = require('./store-json')` works),
 * plus a `createStore({ dataDir })` factory for isolated instances in tests.
 * =========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

function createStore(opts) {
  opts = opts || {};
  const dataDir = opts.dataDir || process.env.FC_DATA_DIR || path.join(__dirname, 'data');
  const draftsFile = path.join(dataDir, 'drafts.json');
  const subsFile = path.join(dataDir, 'submissions.json');
  const usersFile = path.join(dataDir, 'users.json');
  const sessionsFile = path.join(dataDir, 'sessions.json');
  const auditFile = path.join(dataDir, 'audit.jsonl');

  let drafts = {};
  let submissions = {};
  let users = { seq: 0, byId: {} };        // { seq, byId: { "1": {user}, ... } }
  let sessions = {};                       // { token_hash: {session} }
  let auditSeq = 0;                        // running id for append-only audit rows

  function loadFile(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return {}; }
  }
  function saveFile(file, obj) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj));
    // atomic-ish; on Windows a sync client or antivirus can hold the target for a
    // moment (EPERM/EBUSY) — retry briefly rather than lose the write
    for (let attempt = 0; ; attempt++) {
      try { fs.renameSync(tmp, file); return; }
      catch (e) {
        if (attempt >= 5 || !(e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES')) throw e;
        const until = Date.now() + 20 * (attempt + 1);
        while (Date.now() < until) { /* short blocking wait; the store is synchronous by design */ }
      }
    }
  }

  // ── users: normalization + raw lookup (raw = mutable object for in-place edits)
  function normUser(u) {
    if (!u) return null;
    return {
      id: u.id, username: u.username, display_name: u.display_name,
      password_hash: u.password_hash, role: u.role,
      active: !!u.active, created_at: u.created_at == null ? null : u.created_at
    };
  }
  function rawUserByUsername(username) {
    const ids = Object.keys(users.byId);
    for (let i = 0; i < ids.length; i++) {
      const u = users.byId[ids[i]];
      if (u && u.username === username) return u;
    }
    return null;
  }

  return {
    kind: 'json',

    init() {
      fs.mkdirSync(dataDir, { recursive: true });
      drafts = loadFile(draftsFile);
      submissions = loadFile(subsFile);
      const u = loadFile(usersFile);
      users = (u && u.byId) ? { seq: u.seq || 0, byId: u.byId } : { seq: 0, byId: {} };
      sessions = loadFile(sessionsFile);
      // audit id sequence = number of existing lines (append-only file)
      try {
        auditSeq = fs.readFileSync(auditFile, 'utf8')
          .split('\n').filter(function (l) { return l.trim(); }).length;
      } catch (e) { auditSeq = 0; }
      return this;
    },

    // ── drafts ──────────────────────────────────────────────────────────────
    getDraft(ref) {
      return drafts[ref] || null;                      // { data, saved_at, expires_at } | null
    },
    putDraft(ref, record) {
      drafts[ref] = record;
      saveFile(draftsFile, drafts);
    },
    deleteDraft(ref) {
      delete drafts[ref];
      saveFile(draftsFile, drafts);
    },
    purgeExpiredDrafts(now) {
      let n = 0;
      Object.keys(drafts).forEach(function (ref) {
        const r = drafts[ref];
        if (r && r.expires_at && r.expires_at < now) { delete drafts[ref]; n++; }
      });
      if (n) saveFile(draftsFile, drafts);
      return n;
    },

    // ── submissions ─────────────────────────────────────────────────────────
    getSubmission(ref) {
      const rec = submissions[ref] || null;            // full record incl. history[]
      if (rec && !('archived_at' in rec)) rec.archived_at = null;   // same field set as the SQLite store
      return rec;
    },
    putSubmission(ref, record) {
      submissions[ref] = record;
      saveFile(subsFile, submissions);
    },
    listSubmissions() {
      // The array the admin list route builds its response from (full records).
      return Object.keys(submissions).map(function (k) { const r = submissions[k]; if (!('archived_at' in r)) r.archived_at = null; return r; });
    },
    // archive marker: an epoch-ms timestamp, or null to restore. Returns false if the case is unknown.
    setArchived(ref, ts) {
      const rec = submissions[ref];
      if (!rec) return false;
      rec.archived_at = ts == null ? null : ts;
      saveFile(subsFile, submissions);
      return true;
    },
    updateStatus(ref, status, statusDv, entry) {
      const rec = submissions[ref];
      if (!rec) return;
      rec.status = status; rec.status_dv = statusDv;
      this.appendHistory(ref, entry);                 // one saveFile, inside appendHistory
    },
    appendHistory(ref, entry) {
      const rec = submissions[ref];
      if (!rec) return;
      rec.history = rec.history || [];
      // Normalize to a fixed shape so json and sqlite return the identical
      // history-entry field set. changed_by / changed_by_name are set from the
      // authenticated actor by the server (spec 02); null for public/system rows.
      rec.history.push({
        status: entry.status == null ? null : entry.status,
        status_dv: entry.status_dv == null ? null : entry.status_dv,
        timestamp: entry.timestamp == null ? Date.now() : entry.timestamp,
        note: entry.note == null ? '' : entry.note,
        changed_by: entry.changed_by == null ? null : entry.changed_by,
        changed_by_name: entry.changed_by_name == null ? null : entry.changed_by_name
      });
      saveFile(subsFile, submissions);
    },

    // ── staff users ────────────
    getUserByUsername(username) {
      return normUser(rawUserByUsername(username));
    },
    getUserById(id) {
      return normUser(users.byId[String(id)]);
    },
    createUser(user) {
      if (rawUserByUsername(user.username)) {
        throw new Error('username already exists: ' + user.username);
      }
      users.seq = (users.seq || 0) + 1;
      const row = {
        id: users.seq, username: user.username, display_name: user.display_name,
        password_hash: user.password_hash, role: user.role || 'officer',
        active: user.active == null ? true : !!user.active,
        created_at: user.created_at == null ? Date.now() : user.created_at
      };
      users.byId[String(row.id)] = row;
      saveFile(usersFile, users);
      return normUser(row);
    },
    listUsers() {
      return Object.keys(users.byId)
        .map(function (k) { return normUser(users.byId[k]); })
        .sort(function (a, b) { return a.id - b.id; });
    },
    setUserActive(username, active) {
      const u = rawUserByUsername(username);
      if (!u) return false;
      u.active = !!active;
      saveFile(usersFile, users);
      return true;
    },
    setUserPassword(username, passwordHash) {
      const u = rawUserByUsername(username);
      if (!u) return false;
      u.password_hash = passwordHash;
      saveFile(usersFile, users);
      return true;
    },

    // ── sessions ) ─────────────
    createSession(session) {
      sessions[session.token_hash] = {
        token_hash: session.token_hash, user_id: session.user_id,
        created_at: session.created_at, expires_at: session.expires_at,
        last_used: session.last_used
      };
      saveFile(sessionsFile, sessions);
    },
    getSession(tokenHash) {
      return sessions[tokenHash] || null;
    },
    touchSession(tokenHash, lastUsed, expiresAt) {
      const s = sessions[tokenHash];
      if (!s) return false;
      s.last_used = lastUsed;
      s.expires_at = expiresAt;
      saveFile(sessionsFile, sessions);
      return true;
    },
    deleteSession(tokenHash) {
      delete sessions[tokenHash];
      saveFile(sessionsFile, sessions);
    },
    deleteSessionsForUser(userId) {
      let n = 0;
      Object.keys(sessions).forEach(function (h) { if (sessions[h].user_id === userId) { delete sessions[h]; n++; } });
      if (n) saveFile(sessionsFile, sessions);
      return n;
    },
    purgeExpiredSessions(now) {
      let n = 0;
      Object.keys(sessions).forEach(function (h) { const s = sessions[h]; if (s.expires_at && s.expires_at < now) { delete sessions[h]; n++; } });
      if (n) saveFile(sessionsFile, sessions);
      return n;
    },

    // ── audit log ──────
    insertAudit(entry) {
      auditSeq += 1;
      const row = {
        id: auditSeq,
        at: entry.at == null ? Date.now() : entry.at,
        actor_user_id: entry.actor_user_id == null ? null : entry.actor_user_id,
        actor_name: entry.actor_name == null ? null : entry.actor_name,
        action: entry.action,
        ref_code: entry.ref_code == null ? null : entry.ref_code,
        ip: entry.ip == null ? null : entry.ip,
        details: entry.details == null ? null : entry.details
      };
      fs.appendFileSync(auditFile, JSON.stringify(row) + '\n');   // append-only
      return row;
    },
    listAudit(filters) {
      filters = filters || {};
      let rows;
      try {
        rows = fs.readFileSync(auditFile, 'utf8').split('\n')
          .filter(function (l) { return l.trim(); })
          .map(function (l) { try { return JSON.parse(l); } catch (e) { return null; } })
          .filter(Boolean);
      } catch (e) { rows = []; }
      if (filters.ref) rows = rows.filter(function (r) { return r.ref_code === filters.ref; });
      rows.sort(function (a, b) { return (b.at - a.at) || (b.id - a.id); });   // newest first
      const limit = filters.limit && filters.limit > 0 ? filters.limit : rows.length;
      return rows.slice(0, limit);
    },

    close() { /* nothing to close for the file store */ }
  };
}

module.exports = createStore();          // singleton for server.js
module.exports.createStore = createStore; // factory for isolated test instances
