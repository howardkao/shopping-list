#!/usr/bin/env node
/**
 * Per-household migration: shopping-list stored as a JS array (RTDB renders it as
 * `{0: item, 1: item, ...}`) → object keyed by item id (`{<id>: item, ...}`).
 *
 * Why: every list mutation in the old client used `set('shopping-list', wholeArray)`,
 * which made concurrent offline writes from multiple household members overwrite each
 * other on reconnect (last-write-wins on the whole path). The new client writes
 * per-item via `update`, so concurrent edits to different items merge cleanly.
 *
 * Reads tolerate both shapes, so this migration only needs to run once per household
 * before deploying the new client.
 *
 * Idempotent: if every key in the existing object equals `String(item.id)`, this
 * script reports "already migrated" and skips.
 *
 * Usage:
 *   node scripts/migrate-shopping-list-to-keyed.cjs <householdId>
 *   node scripts/migrate-shopping-list-to-keyed.cjs --all
 *   node scripts/migrate-shopping-list-to-keyed.cjs --dry-run --all
 *
 * Requires Firebase CLI authenticated to the target project.
 */

const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');

function dbGet(path) {
  const raw = execSync(`firebase database:get "${path}"`).toString().trim();
  return raw === 'null' ? null : JSON.parse(raw);
}

function dbSet(path, data) {
  const file = `${os.tmpdir()}/fb-shopping-list-keyed-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
  fs.writeFileSync(file, JSON.stringify(data));
  try {
    execSync(`firebase database:set --force "${path}" "${file}"`);
  } finally {
    fs.unlinkSync(file);
  }
}

function migrateHousehold(hid, { dryRun = false } = {}) {
  console.log(`\n=== Household ${hid} ===`);
  const list = dbGet(`/households/${hid}/shopping-list`);

  if (list == null) {
    console.log('  No shopping-list node. Nothing to do.');
    return { skipped: true, reason: 'empty' };
  }

  // Already-migrated detection: keys equal String(item.id) for every entry.
  if (!Array.isArray(list) && typeof list === 'object') {
    const entries = Object.entries(list);
    const allKeysMatchIds = entries.length > 0
      && entries.every(([k, v]) => v != null && String(v.id) === k);
    if (allKeysMatchIds) {
      console.log(`  Already keyed by id (${entries.length} items). Skipping.`);
      return { skipped: true, reason: 'already-migrated' };
    }
  }

  const items = Array.isArray(list)
    ? list.filter(x => x != null)
    : Object.values(list).filter(x => x != null);

  if (items.length === 0) {
    console.log('  shopping-list is empty after filtering. Nothing to do.');
    return { skipped: true, reason: 'empty-after-filter' };
  }

  const keyed = {};
  let mintedIds = 0;
  for (const item of items) {
    let key;
    if (item.id == null || item.id === '') {
      // Defensive: mint a stable key so we don't lose the row. Random suffix avoids
      // colliding with any sibling that happens to share Date.now().
      key = `mig${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      mintedIds++;
    } else {
      key = String(item.id);
    }
    if (keyed[key]) {
      // Two items with the same id; keep both by tagging the second.
      key = `${key}_dup_${crypto.randomBytes(3).toString('hex')}`;
      mintedIds++;
    }
    keyed[key] = { ...item, id: key };
  }

  console.log(
    `  Converting ${items.length} item(s) → keyed object`
    + (mintedIds > 0 ? ` (minted ${mintedIds} fallback id(s))` : '')
    + (dryRun ? ' [dry-run]' : '')
  );

  if (!dryRun) {
    dbSet(`/households/${hid}/shopping-list`, keyed);
    console.log('  Wrote keyed shopping-list.');
  }

  return { migrated: true, count: items.length, mintedIds };
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const rest = args.filter(a => a !== '--dry-run');

  if (rest.length === 0) {
    console.error('Usage: migrate-shopping-list-to-keyed.cjs <householdId> | --all  [--dry-run]');
    process.exit(1);
  }

  if (rest[0] === '--all') {
    const households = dbGet('/households');
    if (!households) {
      console.log('No /households node found. Nothing to do.');
      return;
    }
    const ids = Object.keys(households);
    console.log(`Found ${ids.length} household(s). dryRun=${dryRun}`);
    const results = [];
    for (const hid of ids) {
      try {
        results.push({ hid, ...migrateHousehold(hid, { dryRun }) });
      } catch (err) {
        console.error(`  ERROR for ${hid}: ${err.message}`);
        results.push({ hid, error: err.message });
      }
    }
    const migrated = results.filter(r => r.migrated).length;
    const skipped = results.filter(r => r.skipped).length;
    const errored = results.filter(r => r.error).length;
    console.log(`\nDone. migrated=${migrated} skipped=${skipped} errored=${errored}`);
  } else {
    migrateHousehold(rest[0], { dryRun });
  }
}

main();
