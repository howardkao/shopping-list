#!/usr/bin/env node
/**
 * Reseed one household's taxonomy with the full seed catalog, and preserve
 * its legacy category names + items as per-aisle "(legacy)" categories so the
 * user can reorganize in-app and then run merge-legacy-into-seed.cjs.
 *
 * Destructive to /households/{hid}/taxonomy/*  — overwrites any existing
 * aisles / categories / visible-items / library. Shopping-list items are
 * remapped so active list entries keep pointing at the right (legacy) category.
 *
 * Usage:
 *   node scripts/reseed-with-legacy.cjs <householdId>            [--dry-run]
 *
 * Requires Firebase CLI authenticated to the target project.
 */

const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Same mapping table used by migrate-to-taxonomy-v2.cjs.
const LEGACY_TO_AISLE = {
  'PRODUCE':              'fruit',
  'MEAT & FISH':          'meat-seafood',
  'DELI, DAIRY & EGGS':   'dairy-eggs',
  'FROZEN':               'frozen',
  'DRY GOODS':            'packaged-foods',
  'BAKING, SPICES & OILS':'baking-spices-oils',
  'PREPARED FOODS':       'bakery-prepared',
  'HOUSEHOLD & PHARMACY': 'pharmacy-personal',
  'OTHER':                null, // MISC

  'VEGGIES':                          'veggies',
  'FRUIT':                            'fruit',
  'DELI, DAIRY, EGGS':                'dairy-eggs',
  'PHARMACY / OTC':                   'pharmacy-personal',
  'TARGET / AMAZON / COSTCO':         'household-bulk',
  'COSTCO BULK FOODS':                'household-bulk',
  'RANCH 99 / WEEE / BERKELEY BOWL':  'veggies',
};

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

function dbGet(p) {
  const raw = execSync(`firebase database:get "${p}"`).toString().trim();
  return raw === 'null' ? null : JSON.parse(raw);
}
function dbSet(p, data) {
  const file = `${os.tmpdir()}/fb-reseed-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
  fs.writeFileSync(file, JSON.stringify(data));
  execSync(`firebase database:set --force "${p}" "${file}"`);
  fs.unlinkSync(file);
}
function dbUpdate(p, data) {
  const file = `${os.tmpdir()}/fb-reseed-upd-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
  fs.writeFileSync(file, JSON.stringify(data));
  execSync(`firebase database:update "${p}" "${file}"`);
  fs.unlinkSync(file);
}

async function loadSeed() {
  const mod = await import(path.join('file://', path.resolve(__dirname, '..', 'src', 'seedCatalog.js')));
  return { AISLES: mod.SEED_AISLES, CATEGORIES: mod.SEED_CATEGORIES, ITEMS: mod.SEED_ITEMS };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const rest = args.filter((a) => a !== '--dry-run');
  if (rest.length !== 1) {
    console.error('Usage: reseed-with-legacy.cjs <householdId> [--dry-run]');
    process.exit(1);
  }
  const hid = rest[0];

  const seed = await loadSeed();

  console.log(`\n=== Reseed ${hid} (dryRun=${dryRun}) ===`);

  // --- Pull current state ---
  const oldTax       = dbGet(`/households/${hid}/taxonomy`) || {};
  const oldCatsV2    = oldTax.categories || {};
  const legacyCommon = dbGet(`/households/${hid}/common-items`)      || {};
  const legacyLess   = dbGet(`/households/${hid}/less-common-items`) || {};
  const legacyHist   = dbGet(`/households/${hid}/shopping-history`)  || [];
  const shoppingList = dbGet(`/households/${hid}/shopping-list`)     || [];

  // --- Build fresh seed taxonomy ---
  const aisleIdBySlug = {};
  const aislesOut = {};
  seed.AISLES.forEach((a, idx) => {
    const id = generatePushId();
    aisleIdBySlug[a.id] = id;
    aislesOut[id] = { name: a.name, order: idx };
  });

  const categoryIdBySlug = {};
  const categoriesOut = {};
  for (const c of seed.CATEGORIES) {
    const id = generatePushId();
    categoryIdBySlug[c.id] = id;
    categoriesOut[id] = { name: c.name, aisleId: aisleIdBySlug[c.aisleId], hidden: false };
  }

  const visibleOut = {};
  const libraryOut = {};
  for (const item of seed.ITEMS) {
    const catId = categoryIdBySlug[item.categoryId];
    if (!catId) continue;
    const bucket = item.starred ? visibleOut : libraryOut;
    if (!bucket[catId]) bucket[catId] = [];
    bucket[catId].push({ id: generatePushId(), name: item.name });
  }

  // --- Collect legacy category names ---
  const legacyNames = new Set();
  for (const enc of Object.keys(legacyCommon)) legacyNames.add(decodeCategory(enc));
  for (const enc of Object.keys(legacyLess))   legacyNames.add(decodeCategory(enc));
  // Also include names from the current v2 taxonomy in case legacy*-items was already wiped.
  for (const c of Object.values(oldCatsV2)) {
    if (c?.name) legacyNames.add(c.name);
  }

  // --- Ensure MISC aisle exists if any legacy name maps to null/unknown ---
  let miscAisleId = null;
  function ensureMiscAisle() {
    if (miscAisleId) return miscAisleId;
    miscAisleId = generatePushId();
    const order = Object.keys(aislesOut).length;
    aislesOut[miscAisleId] = { name: 'Misc', order };
    return miscAisleId;
  }

  // --- Create a "<LegacyName> (legacy)" category per legacy name, and
  //     populate visible/library from legacy common/less data by name match ---
  const legacyCatIdByName = {};
  for (const legacyName of legacyNames) {
    const mapped = LEGACY_TO_AISLE[legacyName];
    const aisleId = (mapped && aisleIdBySlug[mapped]) || ensureMiscAisle();
    const catId = generatePushId();
    categoriesOut[catId] = {
      name: `${legacyName} (legacy)`,
      aisleId,
      hidden: false,
      legacy: true,
    };
    legacyCatIdByName[legacyName] = catId;

    // Pull items from legacy common/less for this name.
    const commonItems = legacyCommon[encodeCategory(legacyName)] || [];
    const lessItems   = legacyLess  [encodeCategory(legacyName)] || [];

    const vis = commonItems
      .filter(Boolean)
      .map((it) => ({ id: it.id || generatePushId(), name: it.name }));
    if (vis.length) visibleOut[catId] = (visibleOut[catId] || []).concat(vis);

    const visNames = new Set(vis.map((i) => i.name.toLowerCase()));
    const lib = lessItems
      .filter(Boolean)
      .filter((it) => !visNames.has(String(it.name).toLowerCase()))
      .map((it) => ({ id: it.id || generatePushId(), name: it.name }));
    if (lib.length) libraryOut[catId] = (libraryOut[catId] || []).concat(lib);

    // Also fold in items from the existing v2 taxonomy (in case the first
    // migration already moved legacy data there and legacy-items was cleared).
    const oldV2CatIds = Object.entries(oldCatsV2)
      .filter(([, c]) => c?.name === legacyName)
      .map(([id]) => id);
    for (const oldCatId of oldV2CatIds) {
      const oldVis = Object.values((oldTax['visible-items'] || {})[oldCatId] || {});
      const oldLib = Object.values((oldTax['library']       || {})[oldCatId] || {});
      const known  = new Set([
        ...(visibleOut[catId] || []).map((i) => i.name.toLowerCase()),
        ...(libraryOut[catId] || []).map((i) => i.name.toLowerCase()),
      ]);
      for (const it of oldVis) {
        if (!it || known.has(String(it.name).toLowerCase())) continue;
        (visibleOut[catId] = visibleOut[catId] || []).push({ id: it.id || generatePushId(), name: it.name });
        known.add(it.name.toLowerCase());
      }
      for (const it of oldLib) {
        if (!it || known.has(String(it.name).toLowerCase())) continue;
        (libraryOut[catId] = libraryOut[catId] || []).push({ id: it.id || generatePushId(), name: it.name });
        known.add(it.name.toLowerCase());
      }
    }
  }

  // --- Fold shopping-history entries into a MISC (legacy) category if nothing else holds them ---
  const allKnown = new Set();
  for (const items of Object.values(visibleOut)) items.forEach((i) => allKnown.add(i.name.toLowerCase()));
  for (const items of Object.values(libraryOut)) items.forEach((i) => allKnown.add(i.name.toLowerCase()));
  const historyOrphans = [];
  for (const raw of legacyHist) {
    if (!raw || typeof raw !== 'string') continue;
    const low = raw.toLowerCase();
    if (allKnown.has(low)) continue;
    allKnown.add(low);
    historyOrphans.push({ id: generatePushId(), name: raw });
  }
  if (historyOrphans.length) {
    const aisleId = ensureMiscAisle();
    const catId = generatePushId();
    categoriesOut[catId] = { name: 'HISTORY (legacy)', aisleId, hidden: false, legacy: true };
    libraryOut[catId] = historyOrphans;
  }

  // --- Remap active shopping-list items to the new legacy category ids ---
  const oldCatIdToNewLegacy = {};
  for (const [oldId, c] of Object.entries(oldCatsV2)) {
    if (c?.name && legacyCatIdByName[c.name]) {
      oldCatIdToNewLegacy[oldId] = legacyCatIdByName[c.name];
    }
  }
  const remappedList = (Array.isArray(shoppingList) ? shoppingList : Object.values(shoppingList))
    .filter(Boolean)
    .map((item) => {
      let newCatId = null;
      let newCatName = item.category;
      if (item.categoryId && oldCatIdToNewLegacy[item.categoryId]) {
        newCatId = oldCatIdToNewLegacy[item.categoryId];
      } else if (item.category && legacyCatIdByName[item.category]) {
        newCatId = legacyCatIdByName[item.category];
      }
      if (newCatId) {
        newCatName = categoriesOut[newCatId].name;
        return { ...item, categoryId: newCatId, category: newCatName };
      }
      return item;
    });
  const listChanged = JSON.stringify(remappedList) !== JSON.stringify(shoppingList);

  // --- Summary ---
  const summary = {
    aisles: Object.keys(aislesOut).length,
    categories: Object.keys(categoriesOut).length,
    legacyCategories: Object.values(categoriesOut).filter((c) => c.legacy).length,
    visibleBuckets: Object.keys(visibleOut).length,
    libraryBuckets: Object.keys(libraryOut).length,
    visibleItems: Object.values(visibleOut).reduce((n, a) => n + a.length, 0),
    libraryItems: Object.values(libraryOut).reduce((n, a) => n + a.length, 0),
    historyOrphans: historyOrphans.length,
    listItemsRemapped: remappedList.filter((v, i) => shoppingList[i] && v.categoryId !== shoppingList[i].categoryId).length,
    legacyNames: Array.from(legacyNames),
  };
  console.log(JSON.stringify(summary, null, 2));

  if (dryRun) {
    console.log('\nDRY RUN — no writes.');
    return;
  }

  // --- Write (atomic per subtree) ---
  const base = `/households/${hid}/taxonomy`;
  // Wipe the taxonomy node first so stale ids can't linger.
  dbSet(base, null);
  dbSet(`${base}/aisles`,        aislesOut);
  dbSet(`${base}/categories`,    categoriesOut);
  dbSet(`${base}/visible-items`, visibleOut);
  dbSet(`${base}/library`,       libraryOut);
  dbSet(`${base}/migrated`, true);
  dbSet(`${base}/onboarding_completed`, false);

  if (listChanged) {
    dbSet(`/households/${hid}/shopping-list`, remappedList);
  }

  console.log('\n✅ Reseed complete. User will see onboarding on next load.');
}

main().catch((e) => { console.error(e); process.exit(1); });
