/* ===========================================================================
 * auth.js — password hashing, DB-backed sessions, role checks
 * ---------------------------------------------------------------------------
 * Zero new dependencies: passwords use Node's built-in crypto.scryptSync,
 * sessions are random tokens whose sha256 hash is what the store persists (a
 * DB leak must not leak usable tokens). Identity is ALWAYS derived here, from
 * the session, on the server — never from anything the client sends.
 *
 * The store is passed in explicitly (createSession/sessionUser take `store`) so
 * this module stays store-agnostic and testable against either FC_STORE.
 *
 * Password format:  scrypt$<saltHex>$<hashHex>
 *   - 32-byte random salt (crypto.randomBytes), N=16384, r=8, p=1, 32-byte key
 *   - verify recomputes and compares with crypto.timingSafeEqual on equal-length
 *     buffers (timingSafeEqual throws on unequal lengths — guarded below).
 * =========================================================================== */
'use strict';
const crypto = require('crypto');

const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1, KEYLEN = 32, SALT_BYTES = 32;
// scrypt memory ≈ 128 * N * r = 16 MiB; raise maxmem above Node's 32 MiB default
// headroom is fine, but set it explicitly so a future N bump can't surprise us.
const SCRYPT_OPTS = { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 };

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;        // 8 hours
const SESSION_REFRESH_MS = 60 * 60 * 1000;        // only slide expiry when >1h old

// viewer < officer = registrar < admin. requireRole(user,'officer') => rank>=2,
// which is exactly the Court's "role >= officer" bar for mutating a submission.
const ROLE_RANK = { viewer: 1, officer: 2, registrar: 2, admin: 3 };

function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }

function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = crypto.scryptSync(String(password), salt, KEYLEN, SCRYPT_OPTS);
  return 'scrypt$' + salt.toString('hex') + '$' + hash.toString('hex');
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  let expected, actual;
  try {
    const salt = Buffer.from(parts[1], 'hex');
    expected = Buffer.from(parts[2], 'hex');
    actual = crypto.scryptSync(String(password), salt, expected.length, SCRYPT_OPTS);
  } catch (e) { return false; }
  if (actual.length !== expected.length) return false;   // guard timingSafeEqual
  return crypto.timingSafeEqual(actual, expected);
}

// Pull "Bearer <token>" out of the Authorization header (or '' if absent).
function bearerToken(req) {
  const h = (req.headers && req.headers['authorization']) || '';
  const m = /^Bearer\s+(.+)$/.exec(h);
  return m ? m[1].trim() : '';
}

// Create a session for userId; returns the RAW token exactly once (only its
// sha256 hash is persisted). Caller sends the raw token back to the client.
function createSession(store, userId) {
  const token = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  store.createSession({
    token_hash: sha256(token), user_id: userId,
    created_at: now, expires_at: now + SESSION_TTL_MS, last_used: now
  });
  return token;
}

// Resolve the authenticated staff user from the request, or null. Enforces:
// token present -> session exists -> not expired -> user exists -> user active.
// Slides expiry forward, but writes only when the session is >1h stale (so a
// busy admin session doesn't hammer the store on every request).
function sessionUser(store, req) {
  const token = bearerToken(req);
  if (!token) return null;
  const hash = sha256(token);
  const sess = store.getSession(hash);
  if (!sess) return null;
  const now = Date.now();
  if (!sess.expires_at || sess.expires_at < now) {
    try { store.deleteSession(hash); } catch (e) { /* best-effort cleanup */ }
    return null;
  }
  const user = store.getUserById(sess.user_id);
  if (!user || !user.active) return null;
  if (!sess.last_used || (now - sess.last_used) > SESSION_REFRESH_MS) {
    try { store.touchSession(hash, now, now + SESSION_TTL_MS); } catch (e) { /* non-fatal */ }
  }
  return user;
}

function requireRole(user, minRole) {
  if (!user) return false;
  return (ROLE_RANK[user.role] || 0) >= (ROLE_RANK[minRole] || 0);
}

module.exports = {
  sha256, hashPassword, verifyPassword, bearerToken,
  createSession, sessionUser, requireRole,
  SESSION_TTL_MS, SESSION_REFRESH_MS, ROLE_RANK
};
