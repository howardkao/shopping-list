#!/usr/bin/env node
/**
 * One-time migration: move root-level single-household data into
 * /households/{householdId}/ and update user records with householdId.
 *
 * Safe to re-run: exits early if /households already exists.
 * Does NOT touch /logs (stays at root, not household-scoped).
 *
 * Run from project root: node scripts/migrate-to-households.js
 * Requires Firebase CLI to be installed and authenticated.
 */

const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

function generatePushId() {
  const CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
  let now = Date.now();
  let id = '';
  for (let i = 7; i >= 0; i--) {
    id = CHARS[now % 64] + id;
    now = Math.floor(now / 64);
  }
  const rand = crypto.randomBytes(12);
  for (let i = 0; i < 12; i++) id += CHARS[rand[i] % 64];
  return id;
}

function dbGet(path) {
  const raw = execSync(`firebase database:get "${path}"`).toString().trim();
  return JSON.parse(raw);
}

function dbSet(path, data) {
  const file = `${os.tmpdir()}/fb-migration-${Date.now()}.json`;
  fs.writeFileSync(file, JSON.stringify(data));
  execSync(`firebase database:set --force "${path}" "${file}"`);
  fs.unlinkSync(file);
}

function dbRemove(path) {
  execSync(`firebase database:remove --force "${path}"`);
}

// --- Safety check ---
console.log('Checking current database state...');
const topLevel = JSON.parse(execSync('firebase database:get / --shallow').toString());

if (topLevel.households) {
  console.log('⚠️  /households already exists — migration has already run. Aborting.');
  process.exit(0);
}

const PATHS_TO_MIGRATE = ['shopping-list', 'shopping-history', 'common-items',
  'less-common-items', 'categories', 'inviteCodes'];

const hasData = PATHS_TO_MIGRATE.some(p => topLevel[p]);
if (!hasData) {
  console.log('No root-level household data found. Nothing to migrate.');
  process.exit(0);
}

// --- Generate household ID ---
const householdId = generatePushId();
console.log(`\nGenerated household ID: ${householdId}`);

// --- Read data to migrate ---
console.log('Reading root-level data...');
const snapshot = {};
for (const p of PATHS_TO_MIGRATE) {
  if (topLevel[p]) {
    console.log(`  Reading /${p}...`);
    snapshot[p] = dbGet(`/${p}`);
  }
}

// --- Find admin user ---
let adminUid = null;
if (topLevel.users) {
  const users = dbGet('/users');
  for (const [uid, user] of Object.entries(users)) {
    if (user.isFirstUser) { adminUid = uid; break; }
  }
}
console.log(`Admin UID: ${adminUid || '(not found)'}`);

// --- Build and write household ---
const householdData = { createdAt: Date.now() };
if (adminUid) householdData.adminUid = adminUid;
for (const p of PATHS_TO_MIGRATE) {
  if (snapshot[p] !== undefined) householdData[p] = snapshot[p];
}

console.log(`\nWriting /households/${householdId}...`);
dbSet(`/households/${householdId}`, householdData);

// --- Update user records ---
if (topLevel.users) {
  console.log('Updating user records with householdId...');
  const users = dbGet('/users');
  const updatedUsers = {};
  for (const [uid, user] of Object.entries(users)) {
    updatedUsers[uid] = { ...user, householdId };
  }
  dbSet('/users', updatedUsers);
}

// --- Remove old root-level paths ---
console.log('\nRemoving old root-level paths...');
for (const p of PATHS_TO_MIGRATE) {
  if (snapshot[p] !== undefined) {
    console.log(`  Removing /${p}...`);
    dbRemove(`/${p}`);
  }
}

console.log(`
✅ Migration complete!
   Household ID : ${householdId}
   Admin UID    : ${adminUid || 'not found'}
`);
