#!/usr/bin/env node
/**
 * Merge each "(legacy)" category's items into the matching seed category
 * inside its current aisle. Run after the user has reorganized aisles
 * (e.g. renamed a seed aisle to match the legacy one) so every legacy
 * category lives alongside the right seed categories.
 *
 * Matching rules (within the legacy category's aisle only):
 *   1. Exact name match (case-insensitive) against any seed category's
 *      visible or library.
 *   2. Fuzzy match: normalized substring (either side contains the other,
 *      with length-weighted preference for longer/more-specific targets).
 *      Ties broken by: already-visible > library, alphabetical.
 *   3. No match → goes into a per-aisle "Other" category (auto-created,
 *      not marked legacy). Preserves visible/library tier.
 *
 * Visible/library merge rule on move:
 *   - If item was visible in the legacy source, ensure it's visible in the
 *     target; if the target already has it in library, promote to visible.
 *   - Otherwise add to target library (or leave as-is if already visible).
 *
 * Shopping-list entries pointing at the legacy category are remapped to
 * the target category. After all items are moved, the legacy category is
 * deleted.
 *
 * Usage:
 *   node scripts/merge-legacy-into-seed.cjs <householdId> [--dry-run]
 */

const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');

function generatePushId() {
  const CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
  let now = Date.now();
  let id = '';
  for (let i = 7; i >= 0; i--) { id = CHARS[now % 64] + id; now = Math.floor(now / 64); }
  const rand = crypto.randomBytes(12);
  for (let i = 0; i < 12; i++) id += CHARS[rand[i] % 64];
  return id;
}
function dbGet(p) {
  const raw = execSync(`firebase database:get "${p}"`).toString().trim();
  return raw === 'null' ? null : JSON.parse(raw);
}
function dbSet(p, data) {
  const file = `${os.tmpdir()}/fb-merge-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
  fs.writeFileSync(file, JSON.stringify(data));
  execSync(`firebase database:set --force "${p}" "${file}"`);
  fs.unlinkSync(file);
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function asArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean);
  return Object.values(v).filter(Boolean);
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const rest = args.filter((a) => a !== '--dry-run');
  if (rest.length !== 1) {
    console.error('Usage: merge-legacy-into-seed.cjs <householdId> [--dry-run]');
    process.exit(1);
  }
  const hid = rest[0];

  console.log(`\n=== Merge legacy → seed for ${hid} (dryRun=${dryRun}) ===`);

  const tax = dbGet(`/households/${hid}/taxonomy`) || {};
  const categories = tax.categories || {};
  const aisles     = tax.aisles     || {};
  const visibleAll = tax['visible-items'] || {};
  const libraryAll = tax['library']       || {};
  const shoppingList = dbGet(`/households/${hid}/shopping-list`) || [];

  // Working copies so we can apply all mutations in memory, then write once.
  const visible = {};
  const library = {};
  for (const [cid, items] of Object.entries(visibleAll)) visible[cid] = asArray(items).map((i) => ({ ...i }));
  for (const [cid, items] of Object.entries(libraryAll)) library[cid] = asArray(items).map((i) => ({ ...i }));
  const cats = {};
  for (const [cid, c] of Object.entries(categories)) cats[cid] = { ...c };

  // Index categories by aisle (only non-legacy for match targets).
  function targetCatsInAisle(aisleId) {
    return Object.entries(cats)
      .filter(([, c]) => c.aisleId === aisleId && !c.legacy && !c.hidden)
      .map(([cid, c]) => ({ cid, name: c.name }));
  }

  // Find a match for a legacy item within its aisle's seed categories.
  // Returns { targetCid, tier: 'visible'|'library', replaceId } or null.
  function findMatch(itemName, aisleId) {
    const candidates = targetCatsInAisle(aisleId);
    const needle = norm(itemName);

    // Pass 1: exact match.
    let best = null;
    for (const { cid } of candidates) {
      for (const it of (visible[cid] || [])) {
        if (norm(it.name) === needle) return { targetCid: cid, tier: 'visible', replaceId: it.id };
      }
      for (const it of (library[cid] || [])) {
        if (norm(it.name) === needle) return { targetCid: cid, tier: 'library', replaceId: it.id };
      }
    }

    // Pass 2: substring match. Score by shared length relative to longer string.
    for (const { cid } of candidates) {
      for (const tier of ['visible', 'library']) {
        const pool = (tier === 'visible' ? visible : library)[cid] || [];
        for (const it of pool) {
          const hay = norm(it.name);
          if (!hay || !needle) continue;
          const contains = hay.includes(needle) || needle.includes(hay);
          if (!contains) continue;
          const shorter = Math.min(hay.length, needle.length);
          const longer  = Math.max(hay.length, needle.length);
          // Ignore trivial overlaps (e.g. single-letter haystacks).
          if (shorter < 3) continue;
          const score = shorter / longer + (tier === 'visible' ? 0.05 : 0);
          if (!best || score > best.score
              || (score === best.score && it.name < best.name)) {
            best = { targetCid: cid, tier, replaceId: it.id, score, name: it.name };
          }
        }
      }
    }
    if (best) return { targetCid: best.targetCid, tier: best.tier, replaceId: best.replaceId };
    return null;
  }

  // Ensure an "Other" (non-legacy) category exists in the given aisle.
  const otherCatIdByAisle = {};
  function ensureOtherCategory(aisleId) {
    if (otherCatIdByAisle[aisleId]) return otherCatIdByAisle[aisleId];
    // Reuse an existing "Other" if present.
    const existing = Object.entries(cats)
      .find(([, c]) => c.aisleId === aisleId && !c.legacy && norm(c.name) === 'other');
    if (existing) { otherCatIdByAisle[aisleId] = existing[0]; return existing[0]; }
    const newId = generatePushId();
    cats[newId] = { name: 'Other', aisleId, hidden: false };
    otherCatIdByAisle[aisleId] = newId;
    return newId;
  }

  const legacyCatIds = Object.entries(cats).filter(([, c]) => c.legacy).map(([cid]) => cid);

  if (!legacyCatIds.length) {
    console.log('No legacy categories found. Nothing to do.');
    return;
  }

  // Build shopping-list remap table (sourceCid → itemName → newCid).
  const listRemap = {}; // sourceCid: { [nameLower]: newCid }

  const report = [];

  for (const legacyCid of legacyCatIds) {
    const legacyCat = cats[legacyCid];
    const aisleId = legacyCat.aisleId;
    const aisleName = aisles[aisleId]?.name || '<unknown>';
    const movedVisible = []; const movedLibrary = []; const toOther = [];

    // Visible-tier items first (so promote-to-visible logic wins on collisions).
    for (const item of (visible[legacyCid] || [])) {
      const match = findMatch(item.name, aisleId);
      if (match) {
        promoteOrAdd(match.targetCid, item, 'visible');
        movedVisible.push({ name: item.name, target: cats[match.targetCid].name, tier: match.tier, via: match.replaceId ? 'exact-or-fuzzy' : 'new' });
        (listRemap[legacyCid] ||= {})[norm(item.name)] = match.targetCid;
      } else {
        const otherId = ensureOtherCategory(aisleId);
        promoteOrAdd(otherId, item, 'visible');
        toOther.push({ name: item.name, tier: 'visible' });
        (listRemap[legacyCid] ||= {})[norm(item.name)] = otherId;
      }
    }
    for (const item of (library[legacyCid] || [])) {
      const match = findMatch(item.name, aisleId);
      if (match) {
        promoteOrAdd(match.targetCid, item, 'library');
        movedLibrary.push({ name: item.name, target: cats[match.targetCid].name });
        (listRemap[legacyCid] ||= {})[norm(item.name)] = match.targetCid;
      } else {
        const otherId = ensureOtherCategory(aisleId);
        promoteOrAdd(otherId, item, 'library');
        toOther.push({ name: item.name, tier: 'library' });
        (listRemap[legacyCid] ||= {})[norm(item.name)] = otherId;
      }
    }

    report.push({
      legacyCategory: legacyCat.name,
      aisle: aisleName,
      movedVisible: movedVisible.length,
      movedLibrary: movedLibrary.length,
      toOther: toOther.length,
      details: { movedVisible, movedLibrary, toOther },
    });
  }

  function promoteOrAdd(targetCid, item, sourceTier) {
    const key = norm(item.name);
    const visArr = visible[targetCid] || (visible[targetCid] = []);
    const libArr = library[targetCid] || (library[targetCid] = []);
    const inVis  = visArr.findIndex((i) => norm(i.name) === key);
    const inLib  = libArr.findIndex((i) => norm(i.name) === key);
    if (sourceTier === 'visible') {
      if (inVis !== -1) return; // already visible
      if (inLib !== -1) {
        const [existing] = libArr.splice(inLib, 1);
        visArr.push(existing);
        return;
      }
      visArr.push({ id: item.id || generatePushId(), name: item.name });
    } else {
      if (inVis !== -1 || inLib !== -1) return; // don't demote
      libArr.push({ id: item.id || generatePushId(), name: item.name });
    }
  }

  // Delete the now-emptied legacy categories from the working copies.
  for (const legacyCid of legacyCatIds) {
    delete visible[legacyCid];
    delete library[legacyCid];
    delete cats[legacyCid];
  }

  // Remap shopping-list.
  const list = Array.isArray(shoppingList) ? shoppingList : Object.values(shoppingList);
  let listChanged = false;
  const newList = list.filter(Boolean).map((entry) => {
    const src = entry.categoryId;
    if (!src || !listRemap[src]) return entry;
    const nextCid = listRemap[src][norm(entry.name)];
    if (!nextCid) {
      // Item wasn't in visible/library of legacy (shouldn't happen often) —
      // fall back to Other for that aisle, if we know it.
      const aisleId = cats[src]?.aisleId || null;
      const fallback = aisleId ? ensureOtherCategory(aisleId) : null;
      if (!fallback) return entry;
      listChanged = true;
      return { ...entry, categoryId: fallback, category: cats[fallback].name };
    }
    listChanged = true;
    return { ...entry, categoryId: nextCid, category: cats[nextCid].name };
  });

  // Summary.
  console.log(JSON.stringify({
    report,
    otherCategoriesCreated: Object.keys(otherCatIdByAisle).length,
    shoppingListItemsRemapped: listChanged ? newList.filter((v, i) => v.categoryId !== list[i]?.categoryId).length : 0,
  }, null, 2));

  if (dryRun) {
    console.log('\nDRY RUN — no writes.');
    return;
  }

  const base = `/households/${hid}/taxonomy`;
  dbSet(`${base}/categories`,    cats);
  dbSet(`${base}/visible-items`, visible);
  dbSet(`${base}/library`,       library);
  if (listChanged) dbSet(`/households/${hid}/shopping-list`, newList);

  console.log('\n✅ Merge complete.');
}

main();
