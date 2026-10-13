/* ===========================================================================
 * backup.js — online backup for the SQLite store (FC_STORE=sqlite)
 * ---------------------------------------------------------------------------
 * Writes a standalone, consistent, defragmented copy of the database using
 * SQLite's `VACUUM INTO` (the documented alternative to the online-backup API).
 * The source is opened READ-ONLY, so it is safe to run while the server is up;
 * WAL mode lets this reader run without blocking the server's writes. The
 * output is a single self-contained .db file (no -wal/-shm side files), ready
 * to copy off the machine.
 *
 * Usage:
 * node backup.js -> backups/familycourt-<ISO>.db
 * FC_DB_PATH=/srv/fc/familycourt.db node backup.js
 *   node backup.js /path/to/custom.db    -> explicit destination
 *
 * Schedule it (Windows Task Scheduler / cron), then COPY THE OUTPUT OFF-MACHINE.
 * Encryption at rest is the host's job (BitLocker/LUKS). See README.md → Backups
 * for the restore drill.
 * =========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (e) {
  console.error('backup.js needs Node.js >= 22.5 (node:sqlite). This runtime is ' +
    process.version + '. Original error: ' + e.message);
  process.exit(2);
}

const backupsDir = process.env.FC_BACKUP_DIR || path.join(__dirname, 'backups');
fs.mkdirSync(backupsDir, { recursive: true });

// filesystem-safe ISO timestamp: 2026-07-10T14-05-33 (seconds included so
// several backups in one day never overwrite each other)
const stamp = new Date().toISOString().replace(/\.\d+Z$/, '').replace(/:/g, '-');

// Uploaded documents live outside the database: copy the whole uploads root next
// to the database copy (FC_BACKUP_UPLOADS=0 to skip when the volume is snapshotted
// by other means).
const uploadsDir = path.resolve(process.env.FC_UPLOADS_DIR || path.join(__dirname, 'uploads'));
if (process.env.FC_BACKUP_UPLOADS !== '0' && fs.existsSync(uploadsDir)) {
  const udest = path.join(backupsDir, 'uploads-' + stamp);
  try { fs.cpSync(uploadsDir, udest, { recursive: true }); console.log('Uploads copied: ' + udest); }
  catch (e) { console.error('Uploads copy FAILED: ' + e.message); process.exitCode = 1; }
}

// JSON store (FC_STORE unset or json): copy the data folder as-is and stop.
if (process.env.FC_STORE !== 'sqlite') {
  const dataDir = process.env.FC_DATA_DIR || path.join(__dirname, 'data');
  const ddest = path.join(backupsDir, 'data-' + stamp);
  try { fs.cpSync(dataDir, ddest, { recursive: true }); console.log('JSON store copied: ' + ddest); }
  catch (e) { console.error('JSON store copy FAILED: ' + e.message); process.exitCode = 1; }
  console.log('(FC_STORE=sqlite would also produce a consistent .db copy via VACUUM INTO.)');
  process.exit(process.exitCode || 0);
}

const dbPath = process.env.FC_DB_PATH || path.join(__dirname, 'data', 'familycourt.db');
if (!fs.existsSync(dbPath)) {
  console.error('Database not found: ' + dbPath +
    '\n(Set FC_DB_PATH, or run the server with FC_STORE=sqlite first.)');
  process.exit(1);
}
const dest = process.argv[2] || path.join(backupsDir, 'familycourt-' + stamp + '.db');

let db;
try {
  db = new DatabaseSync(dbPath, { readOnly: true });
  db.exec('PRAGMA busy_timeout = 10000');
  db.prepare('VACUUM INTO ?').run(dest);
  const bytes = fs.statSync(dest).size;
  console.log('Backup OK: ' + dest + ' (' + bytes + ' bytes)');
} catch (e) {
  console.error('Backup FAILED: ' + e.message);
  process.exitCode = 1;
} finally {
  if (db) { try { db.close(); } catch (_) { /* ignore */ } }
}
