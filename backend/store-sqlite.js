/* ===========================================================================
 * store-sqlite.js — SQLite store on Node's built-in node:sqlite (Node >= 22.5)
 * ---------------------------------------------------------------------------
 * Opt-in production store, selected with FC_STORE=sqlite. Implements the same
 * synchronous interface as store-json.js so nothing above the store layer knows
 * which is active. Zero npm dependencies — node:sqlite ships with Node 22.5+.
 *
 * Key normalizations vs. the JSON store:
 *   * status history is NOT held on the submission row — it lives in the
 *     submission_history table and is reassembled at the read boundary into the
 *     history:[{status,status_dv,timestamp,note}] shape the frontend expects
 *     (changed_at -> timestamp), ordered by (changed_at, id).
 *   * form `data` and the attachment path list are stored as JSON strings in
 *     TEXT columns — same serialization as the file store, so a record
 *     round-trips to the identical shape from either store.
 *
 * Migrations live in ./migrations/*.sql and are applied once, guarded by
 * PRAGMA user_version. DB path: env.FC_DB_PATH ||./data/familycourt.db.
 *
 * Exports a ready singleton (so `const store = require('./store-sqlite')` works)
 * plus a `createStore({ dbPath })` factory for isolated instances in tests.
 * =========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

// Guard node:sqlite so FC_STORE=sqlite on an old Node fails with a clear message
// instead of a cryptic "Cannot find module 'node:sqlite'".
let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (e) {
  throw new Error(
    'FC_STORE=sqlite requires Node.js >= 22.5 (the built-in node:sqlite module). ' +
    'This runtime is ' + process.version + '. Run on Node 22.5+ (this project targets ' +
    'engines.node >=22), or leave FC_STORE unset / set it to "json" to use the file ' +
    'store. Original error: ' + e.message
  );
}

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function createStore(opts) {
  opts = opts || {};
  const dbPath = opts.dbPath || process.env.FC_DB_PATH || path.join(__dirname, 'data', 'familycourt.db');

  let db = null;
  let stmt = {};                                        // prepared-statement cache (per open connection)

  function prep(key, sql) {
    if (!stmt[key]) stmt[key] = db.prepare(sql);
    return stmt[key];
  }

  // Apply any migration whose leading number is greater than PRAGMA user_version,
  // each in its own transaction, bumping user_version to that number. Idempotent:
  // a second boot sees user_version already at the latest and runs nothing.
  function migrate() {
    const current = db.prepare('PRAGMA user_version').get().user_version;
    const files = fs.existsSync(MIGRATIONS_DIR)
      ? fs.readdirSync(MIGRATIONS_DIR).filter(function (f) { return /^\d+.*\.sql$/.test(f); }).sort()
      : [];
    files.forEach(function (f) {
      const version = parseInt(f, 10);                  // "001-init.sql" -> 1
      if (!version || version <= current) return;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
      db.exec('BEGIN');
      try {
        db.exec(sql);
        db.exec('PRAGMA user_version = ' + version);    // version is an integer we control
        db.exec('COMMIT');
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch (_) { /* ignore */ }
        throw new Error('migration ' + f + ' failed: ' + e.message);
      }
    });
  }

  // ── row <-> record mapping ──────────────────────────────────────────────
  function reassembleHistory(ref) {
    const rows = prep('histByRef',
      'SELECT status, status_dv, note, changed_by, changed_by_name, changed_at ' +
      'FROM submission_history WHERE ref_code = ? ORDER BY changed_at, id'
    ).all(ref);
    return rows.map(function (r) {
      return {
        status: r.status,
        status_dv: r.status_dv,
        timestamp: r.changed_at,                        // changed_at -> timestamp
        note: r.note == null ? '' : r.note,
        // Attribution (spec 02): who made this change. NULL for public/system
        // rows. Stripped from public status responses by the server; shown in
        // the admin full-record timeline. Kept here so json/sqlite return the
        // identical history-entry field set.
        changed_by: r.changed_by == null ? null : r.changed_by,
        changed_by_name: r.changed_by_name == null ? null : r.changed_by_name
      };
    });
  }

  // Normalize a staff_users row: `active` INTEGER 1/0 -> JS boolean (parity with
  // the JSON store, whose sessionUser check reads user.active as a boolean).
  function userRow(row) {
    if (!row) return null;
    return {
      id: row.id, username: row.username, display_name: row.display_name,
      password_hash: row.password_hash, role: row.role,
      active: !!row.active, created_at: row.created_at == null ? null : row.created_at
    };
  }

  function rowToSubmission(row) {
    if (!row) return null;
    return {
      ref_code: row.ref_code,
      data: row.data == null ? {} : JSON.parse(row.data),
      status: row.status,
      status_dv: row.status_dv,
      submitted_at: row.submitted_at,
      contact_number: row.contact_number == null ? '' : row.contact_number,
      id_number: row.id_number == null ? '' : row.id_number,
      form_code: row.form_code == null ? '' : row.form_code,
      attachments: row.attachments == null ? [] : JSON.parse(row.attachments),
      history: reassembleHistory(row.ref_code)
    };
  }

  return {
    kind: 'sqlite',

    init() {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      db = new DatabaseSync(dbPath);
      stmt = {};
      db.exec('PRAGMA foreign_keys = ON');              // needed for ON DELETE CASCADE
      db.exec('PRAGMA journal_mode = WAL');             // readers (backup.js) don't block the writer
      db.exec('PRAGMA busy_timeout = 5000');
      migrate();
      return this;
    },

    // ── drafts ──────────────────────────────────────────────────────────────
    getDraft(ref) {
      const row = prep('getDraft',
        'SELECT data, saved_at, expires_at FROM drafts WHERE ref_code = ?').get(ref);
      if (!row) return null;
      return {
        data: row.data == null ? undefined : JSON.parse(row.data),
        saved_at: row.saved_at,
        expires_at: row.expires_at
      };
    },
    putDraft(ref, record) {
      // UPSERT (not INSERT OR REPLACE): REPLACE deletes+reinserts the row, which
      // would fire ON DELETE CASCADE and wipe unrelated child rows. Not a factor
      // for drafts, but we keep the same safe pattern the submissions table needs.
      prep('putDraft',
        'INSERT INTO drafts (ref_code, form_code, member_forms, data, saved_at, expires_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?) ' +
        'ON CONFLICT(ref_code) DO UPDATE SET form_code=excluded.form_code, ' +
        'member_forms=excluded.member_forms, data=excluded.data, ' +
        'saved_at=excluded.saved_at, expires_at=excluded.expires_at'
      ).run(
        ref,
        record.form_code == null ? null : record.form_code,
        record.member_forms == null ? null : JSON.stringify(record.member_forms),
        JSON.stringify(record.data == null ? {} : record.data),
        record.saved_at == null ? null : record.saved_at,
        record.expires_at == null ? null : record.expires_at
      );
    },
    deleteDraft(ref) {
      prep('delDraft', 'DELETE FROM drafts WHERE ref_code = ?').run(ref);
    },
    purgeExpiredDrafts(now) {
      const info = prep('purge',
        'DELETE FROM drafts WHERE expires_at IS NOT NULL AND expires_at < ?').run(now);
      return Number(info.changes || 0);
    },

    // ── submissions ─────────────────────────────────────────────────────────
    getSubmission(ref) {
      return rowToSubmission(prep('getSub', 'SELECT * FROM submissions WHERE ref_code = ?').get(ref));
    },
    putSubmission(ref, record) {
      // Writes the submission ROW only — never the history table. History is
      // owned entirely by appendHistory(). Using ON CONFLICT DO UPDATE (an
      // in-place update) rather than INSERT OR REPLACE is what keeps a status
      // update from cascade-deleting this submission's history rows.
      prep('putSub',
        'INSERT INTO submissions ' +
        '(ref_code, form_code, data, id_number, contact_number, status, status_dv, submitted_at, attachments) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
        'ON CONFLICT(ref_code) DO UPDATE SET form_code=excluded.form_code, data=excluded.data, ' +
        'id_number=excluded.id_number, contact_number=excluded.contact_number, ' +
        'status=excluded.status, status_dv=excluded.status_dv, submitted_at=excluded.submitted_at, ' +
        'attachments=excluded.attachments'
      ).run(
        ref,
        record.form_code == null ? null : record.form_code,
        JSON.stringify(record.data == null ? {} : record.data),
        record.id_number == null ? null : record.id_number,
        record.contact_number == null ? null : record.contact_number,
        record.status == null ? 'submitted' : record.status,
        record.status_dv == null ? null : record.status_dv,
        record.submitted_at == null ? null : record.submitted_at,
        JSON.stringify(record.attachments == null ? [] : record.attachments)
      );
    },
    listSubmissions() {
      const rows = prep('listSub', 'SELECT * FROM submissions ORDER BY submitted_at').all();
      return rows.map(rowToSubmission);
    },
    // status row + history entry in ONE transaction (a crash between the two can
    // never leave a status without its timeline row)
    updateStatus(ref, status, statusDv, entry) {
      db.exec('BEGIN');
      try {
        prep('setStatus', 'UPDATE submissions SET status = ?, status_dv = ? WHERE ref_code = ?').run(status, statusDv, ref);
        this.appendHistory(ref, entry);
        db.exec('COMMIT');
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch (_) { /* ignore */ }
        throw e;
      }
    },
    appendHistory(ref, entry) {
      prep('appendHist',
        'INSERT INTO submission_history ' +
        '(ref_code, status, status_dv, note, changed_by, changed_by_name, changed_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(
        ref,
        entry.status == null ? null : entry.status,
        entry.status_dv == null ? null : entry.status_dv,
        entry.note == null ? '' : entry.note,
        entry.changed_by == null ? null : entry.changed_by,          // filled by spec 02 (auth)
        entry.changed_by_name == null ? null : entry.changed_by_name,
        entry.timestamp == null ? Date.now() : entry.timestamp        // timestamp -> changed_at
      );
    },

    // ── staff users ────────────
    getUserByUsername(username) {
      return userRow(prep('getUserByUsername',
        'SELECT * FROM staff_users WHERE username = ?').get(username));
    },
    getUserById(id) {
      return userRow(prep('getUserById',
        'SELECT * FROM staff_users WHERE id = ?').get(id));
    },
    createUser(user) {
      const info = prep('createUser',
        'INSERT INTO staff_users (username, display_name, password_hash, role, active, created_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?)'
      ).run(
        user.username, user.display_name, user.password_hash,
        user.role || 'officer',
        user.active == null ? 1 : (user.active ? 1 : 0),
        user.created_at == null ? Date.now() : user.created_at
      );
      return this.getUserById(Number(info.lastInsertRowid));
    },
    listUsers() {
      return prep('listUsers', 'SELECT * FROM staff_users ORDER BY id').all().map(userRow);
    },
    setUserActive(username, active) {
      const info = prep('setUserActive',
        'UPDATE staff_users SET active = ? WHERE username = ?').run(active ? 1 : 0, username);
      return Number(info.changes) > 0;
    },
    setUserPassword(username, passwordHash) {
      const info = prep('setUserPassword',
        'UPDATE staff_users SET password_hash = ? WHERE username = ?').run(passwordHash, username);
      return Number(info.changes) > 0;
    },

    // ── sessions ) ─────────────
    createSession(session) {
      // UPSERT (not INSERT OR REPLACE) — same reasoning as submissions: never
      // delete+reinsert, so a re-used hash can't cascade-delete anything.
      prep('createSession',
        'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_used) ' +
        'VALUES (?, ?, ?, ?, ?) ' +
        'ON CONFLICT(token_hash) DO UPDATE SET user_id=excluded.user_id, ' +
        'created_at=excluded.created_at, expires_at=excluded.expires_at, last_used=excluded.last_used'
      ).run(session.token_hash, session.user_id, session.created_at, session.expires_at, session.last_used);
    },
    getSession(tokenHash) {
      const row = prep('getSession', 'SELECT * FROM sessions WHERE token_hash = ?').get(tokenHash);
      return row ? {
        token_hash: row.token_hash, user_id: row.user_id, created_at: row.created_at,
        expires_at: row.expires_at, last_used: row.last_used
      } : null;
    },
    touchSession(tokenHash, lastUsed, expiresAt) {
      const info = prep('touchSession',
        'UPDATE sessions SET last_used = ?, expires_at = ? WHERE token_hash = ?')
        .run(lastUsed, expiresAt, tokenHash);
      return Number(info.changes) > 0;
    },
    deleteSession(tokenHash) {
      prep('deleteSession', 'DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    },
    deleteSessionsForUser(userId) {
      const info = prep('deleteSessionsForUser', 'DELETE FROM sessions WHERE user_id = ?').run(userId);
      return Number(info.changes || 0);
    },
    purgeExpiredSessions(now) {
      const info = prep('purgeSessions', 'DELETE FROM sessions WHERE expires_at IS NOT NULL AND expires_at < ?').run(now);
      return Number(info.changes || 0);
    },

    // ── audit log ───
    insertAudit(entry) {
      const info = prep('insertAudit',
        'INSERT INTO audit_log (at, actor_user_id, actor_name, action, ref_code, ip, details) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(
        entry.at == null ? Date.now() : entry.at,
        entry.actor_user_id == null ? null : entry.actor_user_id,
        entry.actor_name == null ? null : entry.actor_name,
        entry.action,
        entry.ref_code == null ? null : entry.ref_code,
        entry.ip == null ? null : entry.ip,
        entry.details == null ? null : entry.details
      );
      return { id: Number(info.lastInsertRowid) };
    },
    listAudit(filters) {
      filters = filters || {};
      const limit = filters.limit && filters.limit > 0 ? filters.limit : 1000000;
      const rows = filters.ref
        ? prep('listAuditRef',
            'SELECT * FROM audit_log WHERE ref_code = ? ORDER BY at DESC, id DESC LIMIT ?')
            .all(filters.ref, limit)
        : prep('listAuditAll',
            'SELECT * FROM audit_log ORDER BY at DESC, id DESC LIMIT ?').all(limit);
      return rows.map(function (r) {
        return {
          id: r.id, at: r.at, actor_user_id: r.actor_user_id, actor_name: r.actor_name,
          action: r.action, ref_code: r.ref_code, ip: r.ip,
          details: r.details == null ? null : r.details
        };
      });
    },

    close() {
      if (db) { try { db.close(); } catch (e) { /* ignore */ } db = null; stmt = {}; }
    },

    // introspection helper for tests (sqlite-only); not part of the store interface
    _userVersion() {
      return db ? db.prepare('PRAGMA user_version').get().user_version : null;
    }
  };
}

module.exports = createStore();          // singleton for server.js
module.exports.createStore = createStore; // factory for isolated test instances
