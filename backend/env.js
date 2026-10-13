'use strict';
/*
 * Reads backend/.env (KEY=VALUE lines, # comments) into process.env before anything
 * else starts. A variable already set in the environment (service manager, Docker,
 * shell) is never overridden. No file, no change.
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '.env');
if (fs.existsSync(file)) {
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const q = value[0];
    if ((q === '"' || q === "'") && value.endsWith(q) && value.length > 1) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
