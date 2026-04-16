#!/usr/bin/env node
/**
 * Per-household migration: legacy flat categories + common/less-common/history
 * → aisle → category → item taxonomy with visible items + library.
 *
 * Legacy shape (inside /households/{hid}/):
 *   common-items/{encodedCategoryName}: Array<{id, name}>
 *   less-common-items/{encodedCategoryName}: Array<{id, name}>
 *   shopping-history: Array<string>
 *   categories: Array<string>  (list of legacy category display names)
 *
 * New shape:
 *   aisles: { [aisleId]: { name, order } }
 *   categories: { [categoryId]: { name, aisleId, hidden: false } }
 *   visible-items/{categoryId}: Array<{id, name}>
 *   library/{categoryId}: Array<{id, name}>
 *   migration/taxonomy_v2: true
 *
 * Runs once per household. Idempotent: aborts if migration.taxonomy_v2 is set.
 * Legacy paths are left in place for one release as a rollback safety net.
 *
 * Usage:
 *   node scripts/migrate-to-taxonomy-v2.cjs <householdId>
 *   node scripts/migrate-to-taxonomy-v2.cjs --all   (iterates every household)
 *   node scripts/migrate-to-taxonomy-v2.cjs --dry-run <householdId>
 *
 * Requires Firebase CLI authenticated to the target project.
 */

const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');

// ---- Seed taxonomy (aisles) used as the default order + mapping targets ----
// Kept in sync with src/seedCatalog.js by convention; not imported because
// this script runs as CJS and the seed file is ESM.
const SEED_AISLES = [
  { id: 'fruit',              name: 'Fruit' },
  { id: 'veggies',            name: 'Veggies' },
  { id: 'meat-seafood',       name: 'Meat & Seafood' },
  { id: 'dairy-eggs',         name: 'Dairy & Eggs' },
  { id: 'frozen',             name: 'Frozen' },
  { id: 'packaged-foods',     name: 'Packaged Foods' },
  { id: 'baking-spices-oils', name: 'Baking, Spices & Oils' },
  { id: 'bakery-prepared',    name: 'Prepared Foods & Bakery' },
  { id: 'pharmacy-personal',  name: 'Personal Care & Pharmacy' },
  { id: 'household-bulk',     name: 'Household & Bulk' },
];

// ---- Legacy category name → best-fit seed aisle id ----
// Covers both the current genericized CATEGORIES and the older personal set.
// Unknown names fall through to the MISC aisle created at runtime.
const LEGACY_TO_AISLE = {
  // Generic set (current CATEGORIES in App.jsx as of 2026-04-14):
  'PRODUCE':              'fruit',
  'MEAT & FISH':          'meat-seafood',
  'DELI, DAIRY & EGGS':   'dairy-eggs',
  'FROZEN':               'frozen',
  'DRY GOODS':            'packaged-foods',
  'BAKING, SPICES & OILS':'baking-spices-oils',
  'PREPARED FOODS':       'bakery-prepared',
  'HOUSEHOLD & PHARMACY': 'pharmacy-personal',
  'OTHER':                null, // MISC

  // Older personal set:
  'VEGGIES':                          'veggies',
  'FRUIT':                            'fruit',
  'DELI, DAIRY, EGGS':                'dairy-eggs',
  'PHARMACY / OTC':                   'pharmacy-personal',
  'TARGET / AMAZON / COSTCO':         'household-bulk',
  'COSTCO BULK FOODS':                'household-bulk',
  'RANCH 99 / WEEE / BERKELEY BOWL':  'veggies',
};

// Category-name encoding used by legacy paths. Matches encodeCategory() in App.jsx.
function encodeCategory(s) {
  return s
    .replace(/\//g, '___SLASH___')
    .replace(/\./g, '___DOT___')
    .replace(/#/g, '___HASH___')
    .replace(/\$/g, '___DOLLAR___')
    .replace(/\[/g, '___LBRACKET___')
    .replace(/\]/g, '___RBRACKET___');
}

function decodeCategory(s) {
  return s
    .replace(/___SLASH___/g, '/')
    .replace(/___DOT___/g, '.')
    .replace(/___HASH___/g, '#')
    .replace(/___DOLLAR___/g, '$')
    .replace(/___LBRACKET___/g, '[')
    .replace(/___RBRACKET___/g, ']');
}

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
  return raw === 'null' ? null : JSON.parse(raw);
}

function dbSet(path, data) {
  const file = `${os.tmpdir()}/fb-taxonomy-v2-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
  fs.writeFileSync(file, JSON.stringify(data));
  execSync(`firebase database:set --force "${path}" "${file}"`);
  fs.unlinkSync(file);
}

// ----- Core migration for one household -----
function migrateHousehold(hid, { dryRun = false } = {}) {
  console.log(`\n=== Household ${hid} ===`);

  const existing = dbGet(`/households/${hid}/taxonomy/migrated`);
  if (existing === true) {
    console.log('  Already migrated (migration.taxonomy_v2 = true). Skipping.');
    return { skipped: true };
  }

  const common  = dbGet(`/households/${hid}/common-items`)      || {};
  const less    = dbGet(`/households/${hid}/less-common-items`) || {};
  const history = dbGet(`/households/${hid}/shopping-history`)  || [];

  // Collect the full set of distinct legacy category names we've seen.
  const legacyCatNames = new Set();
  for (const enc of Object.keys(common)) legacyCatNames.add(decodeCategory(enc));
  for (const enc of Object.keys(less))   legacyCatNames.add(decodeCategory(enc));

  if (legacyCatNames.size === 0 && history.length === 0) {
    console.log('  No legacy suggestion or history data. Marking migrated and exiting.');
    if (!dryRun) {
      dbSet(`/households/${hid}/taxonomy/migrated`, true);
      dbSet(`/households/${hid}/taxonomy/onboarding_completed`, true);
    }
    return { empty: true };
  }

  // Build category records. One new category per distinct legacy name.
  // Its name is preserved verbatim; its aisle is the best-fit seed aisle
  // per LEGACY_TO_AISLE (or MISC if unknown / mapped to null).
  const aislesUsed = new Set();
  const categoriesOut = {}; // catId -> { name, aisleId, hidden }
  const legacyNameToCatId = {}; // legacy display name -> new category id
  let miscAisleId = null;
  let miscCatId = null;

  function ensureMiscAisle() {
    if (!miscAisleId) {
      miscAisleId = generatePushId();
      aislesUsed.add(miscAisleId);
    }
    return miscAisleId;
  }

  function ensureMiscCategory() {
    if (!miscCatId) {
      miscCatId = generatePushId();
      categoriesOut[miscCatId] = {
        name: 'MISC',
        aisleId: ensureMiscAisle(),
        hidden: false,
      };
    }
    return miscCatId;
  }

  for (const legacyName of legacyCatNames) {
    const catId = generatePushId();
    const mapped = LEGACY_TO_AISLE[legacyName];
    let aisleId;
    if (mapped === null || mapped === undefined) {
      aisleId = ensureMiscAisle();
    } else {
      aisleId = mapped;
      aislesUsed.add(mapped);
    }
    categoriesOut[catId] = { name: legacyName, aisleId, hidden: false };
    legacyNameToCatId[legacyName] = catId;
  }

  // Build visible-items from common-items.
  const visibleOut = {}; // catId -> Array<{id, name}>
  for (const [enc, items] of Object.entries(common)) {
    const legacyName = decodeCategory(enc);
    const catId = legacyNameToCatId[legacyName];
    if (!catId) continue;
    visibleOut[catId] = (items || [])
      .filter(Boolean)
      .map(it => ({ id: it.id || generatePushId(), name: it.name }));
  }

  // Build library from less-common-items, then merge history entries that
  // aren't already visible.
  const libraryOut = {}; // catId -> Array<{id, name}>
  const visibleNamesByCat = {};
  for (const [catId, items] of Object.entries(visibleOut)) {
    visibleNamesByCat[catId] = new Set(items.map(i => i.name.toLowerCase()));
  }

  for (const [enc, items] of Object.entries(less)) {
    const legacyName = decodeCategory(enc);
    const catId = legacyNameToCatId[legacyName];
    if (!catId) continue;
    const visibleSet = visibleNamesByCat[catId] || new Set();
    libraryOut[catId] = (items || [])
      .filter(Boolean)
      .filter(it => !visibleSet.has(String(it.name).toLowerCase()))
      .map(it => ({ id: it.id || generatePushId(), name: it.name }));
  }

  // History: names with no category go into MISC library, unless the name
  // already exists somewhere (visible or library) — in which case skip.
  const allKnownLower = new Set();
  for (const items of Object.values(visibleOut))  items.forEach(i => allKnownLower.add(i.name.toLowerCase()));
  for (const items of Object.values(libraryOut))  items.forEach(i => allKnownLower.add(i.name.toLowerCase()));

  const historyForMisc = [];
  for (const rawName of history) {
    if (!rawName || typeof rawName !== 'string') continue;
    const lower = rawName.toLowerCase();
    if (allKnownLower.has(lower)) continue;
    allKnownLower.add(lower);
    historyForMisc.push({ id: generatePushId(), name: rawName });
  }
  if (historyForMisc.length > 0) {
    const catId = ensureMiscCategory();
    libraryOut[catId] = (libraryOut[catId] || []).concat(historyForMisc);
  }

  // Build aisles record. Seed aisles that were actually used retain their
  // seed order; MISC appends to the end.
  const aislesOut = {};
  let order = 0;
  for (const a of SEED_AISLES) {
    if (aislesUsed.has(a.id)) {
      aislesOut[a.id] = { name: a.name, order: order++ };
    }
  }
  if (miscAisleId) {
    aislesOut[miscAisleId] = { name: 'Misc', order: order++ };
  }

  // ---- Write ----
  const summary = {
    aisles: Object.keys(aislesOut).length,
    categories: Object.keys(categoriesOut).length,
    visibleCategories: Object.keys(visibleOut).length,
    libraryCategories: Object.keys(libraryOut).length,
    visibleItems: Object.values(visibleOut).reduce((n, a) => n + a.length, 0),
    libraryItems: Object.values(libraryOut).reduce((n, a) => n + a.length, 0),
    historyMergedIntoMisc: historyForMisc.length,
  };
  console.log('  Migration plan:', summary);

  if (dryRun) {
    console.log('  DRY RUN — no writes performed.');
    return { summary, dryRun: true };
  }

  dbSet(`/households/${hid}/taxonomy/aisles`,     aislesOut);
  dbSet(`/households/${hid}/taxonomy/categories`, categoriesOut);
  if (Object.keys(visibleOut).length > 0) dbSet(`/households/${hid}/taxonomy/visible-items`, visibleOut);
  if (Object.keys(libraryOut).length > 0) dbSet(`/households/${hid}/taxonomy/library`,       libraryOut);
  dbSet(`/households/${hid}/taxonomy/migrated`, true);
  dbSet(`/households/${hid}/taxonomy/onboarding_completed`, true);

  console.log('  ✅ Migrated.');
  return { summary };
}

// ----- CLI -----
function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const rest = args.filter(a => a !== '--dry-run');

  if (rest.length === 0) {
    console.error('Usage: migrate-to-taxonomy-v2.cjs <householdId> | --all  [--dry-run]');
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
    for (const hid of ids) migrateHousehold(hid, { dryRun });
  } else {
    migrateHousehold(rest[0], { dryRun });
  }
}

main();
