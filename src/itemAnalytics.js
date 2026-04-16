// Tier 1 analytics — pure functions over the household item-events log.
//
// Events shape: { ts, uid, name, category, categoryId?, itemKey?, action, source?, qty? }
// Names are normalized to lowercase on write; consumers can trust that.
//
// "visible items" = shortcuts shown as quick-add tiles in Add mode (keyed by categoryId).
// "library" = autocomplete-only items (also keyed by categoryId).

import { getThresholds } from './categoryClassifier.js';
import { computeEffectiveCheckEvents } from './purchaseSemantics.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const itemKey = (name, category) => `${(category || '').toLowerCase()}::${(name || '').toLowerCase()}`;

export function buildItemStats(events, { now = Date.now() } = {}) {
  const effectiveCheckSet = new Set(computeEffectiveCheckEvents(events));
  const stats = new Map();
  for (const e of events) {
    if (!e || !e.name) continue;
    const key = itemKey(e.name, e.category);
    let s = stats.get(key);
    if (!s) {
      s = {
        key,
        name: e.name,
        category: e.category,
        categoryId: e.categoryId || null,
        added: 0,
        checked: 0,
        unchecked: 0,
        removed: 0,
        firstTs: e.ts,
        lastTs: e.ts,
        lastCheckedTs: null,
        lastAddedTs: null,
        sources: { typed: 0, quickAdd: 0, voice: 0, other: 0 },
        users: new Set(),
      };
      stats.set(key, s);
    }
    if (e.categoryId && !s.categoryId) s.categoryId = e.categoryId;
    if (e.ts < s.firstTs) s.firstTs = e.ts;
    if (e.ts > s.lastTs) s.lastTs = e.ts;
    if (e.uid) s.users.add(e.uid);
    if (e.action === 'added') {
      s.added++;
      s.lastAddedTs = Math.max(s.lastAddedTs || 0, e.ts);
      if (e.source === 'typed') s.sources.typed++;
      else if (e.source === 'quickAdd') s.sources.quickAdd++;
      else if (e.source === 'voice') s.sources.voice++;
      else s.sources.other++;
    } else if (e.action === 'checked' && effectiveCheckSet.has(e)) {
      s.checked++;
      s.lastCheckedTs = Math.max(s.lastCheckedTs || 0, e.ts);
    } else if (e.action === 'unchecked') {
      s.unchecked++;
    } else if (e.action === 'removed') {
      s.removed++;
    }
  }
  for (const s of stats.values()) {
    s.daysSinceLastAdd = s.lastAddedTs ? Math.floor((now - s.lastAddedTs) / DAY_MS) : null;
    s.daysSinceLastCheck = s.lastCheckedTs ? Math.floor((now - s.lastCheckedTs) / DAY_MS) : null;
    s.users = Array.from(s.users);
  }
  return stats;
}

/** Top-N most purchased items (by checked count), most-checked first. */
export function topPurchased(events, { limit = 20, sinceDays = null, now = Date.now() } = {}) {
  const filtered = sinceDays ? events.filter(e => now - e.ts <= sinceDays * DAY_MS) : events;
  const stats = buildItemStats(filtered, { now });
  return Array.from(stats.values())
    .filter(s => s.checked > 0)
    .sort((a, b) => b.checked - a.checked || b.lastCheckedTs - a.lastCheckedTs)
    .slice(0, limit);
}

/**
 * Visible (shortcut) items with no add or check activity within their category's
 * dormancy window. Category-aware: fresh items flag sooner than pantry staples.
 *
 * Guards against false positives:
 *   - Per-category minEventAge: won't flag items in a tier until the event stream
 *     is old enough for absence to be meaningful at that tier's cadence.
 *   - Per-item createdAt: won't flag a shortcut that was added more recently than
 *     its category's dormancy window (items without createdAt are treated as old).
 *
 * @param {Array} events — full event stream
 * @param {Record<string, Array<{id, name, createdAt?}>>} visibleItemsByCategoryId
 * @param {Record<string, {name: string}>} categoriesV2
 * @param {{ now?: number }} opts
 */
export function dormantShortcuts(events, visibleItemsByCategoryId, categoriesV2, {
  now = Date.now(),
} = {}) {
  const stats = buildItemStats(events, { now });

  // Compute event stream age once (days since earliest event)
  const earliest = events.length > 0
    ? events.reduce((min, e) => (e.ts < min ? e.ts : min), now)
    : now;
  const streamAgeDays = (now - earliest) / DAY_MS;

  const out = [];
  for (const [catId, items] of Object.entries(visibleItemsByCategoryId || {})) {
    const cat = categoriesV2[catId];
    const catName = cat?.name || '';
    const { dormantDays, minEventAge, tier } = getThresholds(catName, catId);

    // Skip this category if the event stream isn't old enough for this tier
    if (streamAgeDays < minEventAge && events.length > 0) continue;

    for (const item of items || []) {
      // Skip shortcuts added more recently than this category's dormancy window
      if (item.createdAt && (now - item.createdAt) / DAY_MS < dormantDays) continue;

      const nameLower = (item.name || '').toLowerCase();
      // Find matching stat — try exact category match first, then name-only
      let s = stats.get(itemKey(nameLower, catName));
      if (!s) {
        // Fall back to scanning all stats for a name match (category may have been renamed)
        for (const candidate of stats.values()) {
          if (candidate.name === nameLower) { s = candidate; break; }
        }
      }
      const lastUse = s ? Math.max(s.lastAddedTs || 0, s.lastCheckedTs || 0) : 0;
      const days = lastUse ? Math.floor((now - lastUse) / DAY_MS) : null;
      if (days === null || days >= dormantDays) {
        out.push({
          categoryId: catId,
          categoryName: catName,
          suggestionId: item.id,
          name: item.name,
          daysSinceLastUse: days,
          dormantDays,
          tier,
        });
      }
    }
  }
  return out.sort((a, b) => (b.daysSinceLastUse ?? Infinity) - (a.daysSinceLastUse ?? Infinity));
}

/**
 * Items checked (bought) frequently that are not currently visible shortcuts.
 * Uses category-aware thresholds: fresh items qualify faster than pantry/nonfood.
 *
 * @param {Array} events
 * @param {Record<string, Array<{id, name}>>} visibleItemsByCategoryId
 * @param {Record<string, {name: string}>} categoriesV2
 * @param {{ now?: number }} opts
 */
export function promotionCandidates(events, visibleItemsByCategoryId, categoriesV2, { now = Date.now() } = {}) {
  const effectiveCheckSet = new Set(computeEffectiveCheckEvents(events));
  // Build a name→categoryId reverse lookup from visible items
  const visibleNameSet = new Set();
  for (const [catId, items] of Object.entries(visibleItemsByCategoryId || {})) {
    for (const item of items || []) {
      visibleNameSet.add(`${catId}::${(item.name || '').toLowerCase()}`);
    }
  }

  // Build a categoryName → categoryId lookup
  const catIdByName = {};
  for (const [catId, cat] of Object.entries(categoriesV2 || {})) {
    catIdByName[(cat?.name || '').toLowerCase()] = catId;
  }

  // Count checked events per item, within each category's threshold window
  const candidates = new Map(); // key → { name, category, categoryId, checkedCount, lastTs }
  for (const e of events) {
    if (e.action !== 'checked' || !effectiveCheckSet.has(e)) continue;
    const catId = e.categoryId || catIdByName[(e.category || '').toLowerCase()] || null;
    const catName = e.category || '';
    const { promotionChecks, promotionDays } = getThresholds(catName, catId);
    const since = now - promotionDays * DAY_MS;
    if (e.ts < since) continue;

    const key = itemKey(e.name, catName);
    let c = candidates.get(key);
    if (!c) {
      c = { name: e.name, category: catName, categoryId: catId, checkedCount: 0, lastTs: e.ts, threshold: promotionChecks };
      candidates.set(key, c);
    }
    c.checkedCount++;
    if (e.ts > c.lastTs) c.lastTs = e.ts;
  }

  return Array.from(candidates.values())
    .filter(c => {
      if (c.checkedCount < c.threshold) return false;
      // Exclude if already a visible shortcut
      if (c.categoryId && visibleNameSet.has(`${c.categoryId}::${(c.name || '').toLowerCase()}`)) return false;
      // Also check by scanning all categories for name match (in case categoryId didn't resolve)
      for (const [catId, items] of Object.entries(visibleItemsByCategoryId || {})) {
        if ((items || []).some(i => (i.name || '').toLowerCase() === (c.name || '').toLowerCase())) return false;
      }
      return true;
    })
    .sort((a, b) => b.checkedCount - a.checkedCount || b.lastTs - a.lastTs);
}

// --- Legacy API wrappers (for InsightsModal backward compat) ---

/** @deprecated Use dormantShortcuts instead */
export function dormantQuickAddCandidates(events, commonItemsByCategory, { dormantDays = 56, now = Date.now() } = {}) {
  const stats = buildItemStats(events, { now });
  const out = [];
  for (const [category, items] of Object.entries(commonItemsByCategory || {})) {
    for (const item of items || []) {
      const key = itemKey(item.name, category);
      const s = stats.get(key);
      const lastUse = s ? Math.max(s.lastAddedTs || 0, s.lastCheckedTs || 0) : 0;
      const days = lastUse ? Math.floor((now - lastUse) / DAY_MS) : null;
      if (days === null || days >= dormantDays) {
        out.push({ category, name: item.name, daysSinceLastUse: days });
      }
    }
  }
  return out.sort((a, b) => (b.daysSinceLastUse ?? Infinity) - (a.daysSinceLastUse ?? Infinity));
}

/** Per-user contribution split: who added what, who checked off what. */
export function userContributions(events) {
  const effectiveCheckSet = new Set(computeEffectiveCheckEvents(events));
  const users = new Map();
  for (const e of events) {
    if (!e.uid) continue;
    let u = users.get(e.uid);
    if (!u) {
      u = { uid: e.uid, added: 0, checked: 0, removed: 0 };
      users.set(e.uid, u);
    }
    if (e.action === 'added') u.added++;
    else if (e.action === 'checked' && effectiveCheckSet.has(e)) u.checked++;
    else if (e.action === 'removed') u.removed++;
  }
  return Array.from(users.values()).sort((a, b) => (b.added + b.checked) - (a.added + a.checked));
}

/** Summary counters across the full event stream. */
export function eventSummary(events) {
  const effectiveCheckSet = new Set(computeEffectiveCheckEvents(events));
  const out = { total: events.length, added: 0, checked: 0, unchecked: 0, removed: 0, typed: 0, quickAdd: 0, firstTs: null, lastTs: null };
  for (const e of events) {
    if (e.action === 'checked') {
      if (effectiveCheckSet.has(e)) out.checked++;
    } else {
      out[e.action] = (out[e.action] || 0) + 1;
    }
    if (e.source === 'typed') out.typed++;
    else if (e.source === 'quickAdd') out.quickAdd++;
    if (out.firstTs === null || e.ts < out.firstTs) out.firstTs = e.ts;
    if (out.lastTs === null || e.ts > out.lastTs) out.lastTs = e.ts;
  }
  return out;
}
