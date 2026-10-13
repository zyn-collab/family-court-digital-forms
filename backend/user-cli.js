/* ===========================================================================
 * user-cli.js — staff account management
 * ---------------------------------------------------------------------------
 * The ONLY way to create or manage Court staff accounts. There is deliberately
 * no signup or user-management HTTP endpoint — the smallest possible attack
 * surface. Passwords are read from stdin with echo off and stored scrypt-hashed
 * (see auth.js); the plaintext never touches disk or the audit log.
 *
 * Usage (store selected by FC_STORE, default json; FC_STORE=sqlite for sqlite):
 *   node user-cli.js add <username> "<Display Name>" <role>   role: viewer|officer|registrar|admin
 *   node user-cli.js list
 *   node user-cli.js deactivate <username>
 *   node user-cli.js passwd <username>
 *
 * Bootstrap: create the first officer before anyone can log in, e.g.
 *   node user-cli.js add registrar1 "Aminath Registrar" officer
 * =========================================================================== */
'use strict';
const auth = require('./auth');

const VALID_ROLES = ['viewer', 'officer', 'registrar', 'admin'];
const MIN_PASSWORD = 8;

// Refuse to run if the store cannot be opened (e.g. FC_STORE=sqlite on old Node).
const STORE_KIND = process.env.FC_STORE === 'sqlite' ? 'sqlite' : 'json';
let store;
try {
  store = require(STORE_KIND === 'sqlite' ? './store-sqlite' : './store-json');
  store.init();
} catch (e) {
  console.error('Cannot open the ' + STORE_KIND + ' store: ' + e.message);
  process.exit(1);
}

function usage(code) {
  console.log(
    'Family Court staff account CLI (store: ' + STORE_KIND + ')\n\n' +
    'Usage:\n' +
    '  node user-cli.js add <username> "<Display Name>" <role>   role: ' + VALID_ROLES.join('|') + '\n' +
    '  node user-cli.js list\n' +
    '  node user-cli.js deactivate <username>\n' +
    '  node user-cli.js passwd <username>\n\n' +
    'The store is selected by FC_STORE (json | sqlite; default json).'
  );
  process.exit(code || 0);
}

// Hidden-input line reader. One persistent stdin handler feeds a queue of
// completed lines; each promptHidden() takes the next line (or waits for it).
// This correctly handles BOTH a real terminal (raw mode = echo off, char by
// char) AND piped input where several lines arrive in a single chunk. Compared
// by char code so no literal control bytes appear in this source:
// 13=CR 10=LF 4=EOT 3=Ctrl-C 8=BS 127=DEL.
const _lineQueue = [];        // completed lines not yet consumed
const _waiters = [];          // pending resolvers waiting for a line
let _partial = '';            // characters of the line being typed
let _wired = false, _ended = false;

function _restoreTTY() { if (process.stdin.isTTY) { try { process.stdin.setRawMode(false); } catch (e) {} } }
function _deliver() { while (_waiters.length && _lineQueue.length) _waiters.shift()(_lineQueue.shift()); }

function ensureStdin() {
  if (_wired) return;
  _wired = true;
  const stdin = process.stdin;
  stdin.setEncoding('utf8');
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
  stdin.on('data', function (chunk) {
    const s = chunk.toString('utf8');
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      if (code === 3) { process.stdout.write('\n'); _restoreTTY(); process.exit(130); }  // Ctrl-C
      else if (code === 13 || code === 10 || code === 4) {          // end of line
        process.stdout.write('\n');
        _lineQueue.push(_partial); _partial = ''; _deliver();
      } else if (code === 8 || code === 127) {                      // Backspace / DEL
        _partial = _partial.slice(0, -1);
      } else {
        _partial += s[i];
      }
    }
  });
  stdin.on('end', function () {
    _ended = true;
    if (_partial.length) { _lineQueue.push(_partial); _partial = ''; }
    _deliver();
    while (_waiters.length) _waiters.shift()('');                   // never hang on EOF
  });
}

function promptHidden(query) {
  ensureStdin();
  process.stdout.write(query);
  return new Promise(function (resolve) {
    if (_lineQueue.length) return resolve(_lineQueue.shift());
    if (_ended) return resolve('');
    _waiters.push(resolve);
  });
}

async function readNewPassword() {
  const pw = await promptHidden('New password: ');
  if (!pw || pw.length < MIN_PASSWORD) {
    console.error('Password must be at least ' + MIN_PASSWORD + ' characters.');
    process.exit(1);
  }
  const pw2 = await promptHidden('Confirm password: ');
  if (pw !== pw2) { console.error('Passwords do not match.'); process.exit(1); }
  return pw;
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (cmd === 'add') {
    const username = argv[1], displayName = argv[2], role = argv[3];
    if (!username || !displayName || !role) usage(1);
    if (VALID_ROLES.indexOf(role) === -1) {
      console.error('Invalid role "' + role + '" (use: ' + VALID_ROLES.join(' | ') + ')');
      process.exit(1);
    }
    if (store.getUserByUsername(username)) {
      console.error('User already exists: ' + username);
      process.exit(1);
    }
    const pw = await readNewPassword();
    const u = store.createUser({
      username: username, display_name: displayName, role: role,
      password_hash: auth.hashPassword(pw), active: true, created_at: Date.now()
    });
    console.log('Created user #' + u.id + '  ' + u.username + '  (' + u.role + ', active)');

  } else if (cmd === 'list') {
    const rows = store.listUsers();
    if (!rows.length) {
      console.log('(no staff users yet — create one:  node user-cli.js add <username> "<Name>" officer)');
    } else {
      console.log('id  username           display name            role       state');
      rows.forEach(function (u) {
        console.log(
          String(u.id).padEnd(4) +
          String(u.username).padEnd(19) +
          ('"' + u.display_name + '"').padEnd(24) +
          String(u.role).padEnd(11) +
          (u.active ? 'active' : 'INACTIVE')
        );
      });
    }

  } else if (cmd === 'deactivate') {
    const username = argv[1];
    if (!username) usage(1);
    const ok = store.setUserActive(username, false);
    if (!ok) { console.error('No such user: ' + username); process.exit(1); }
    const u = store.getUserByUsername(username);
    const n = u && store.deleteSessionsForUser ? store.deleteSessionsForUser(u.id) : 0;
    console.log('Deactivated ' + username + ' (' + n + ' open session(s) revoked).');

  } else if (cmd === 'passwd') {
    const username = argv[1];
    if (!username) usage(1);
    if (!store.getUserByUsername(username)) { console.error('No such user: ' + username); process.exit(1); }
    const pw = await readNewPassword();
    store.setUserPassword(username, auth.hashPassword(pw));
    const u = store.getUserByUsername(username);
    const n = u && store.deleteSessionsForUser ? store.deleteSessionsForUser(u.id) : 0;
    console.log('Password updated for ' + username + ' (' + n + ' open session(s) revoked).');

  } else {
    usage(cmd ? 1 : 0);
  }

  store.close();
}

main()
  .then(function () { _restoreTTY(); process.exit(0); })   // stdin may be resumed; exit explicitly
  .catch(function (e) { _restoreTTY(); console.error(e && e.message ? e.message : e); process.exit(1); });
