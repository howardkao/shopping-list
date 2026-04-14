// Tier 1 analytics — pure functions over the household item-events log.
// Events shape: { ts, uid, name, category, action, source?, qty? }
// Names are normalized to lowercase on write; consumers can trust that.

const DAY_MS = 24 * 60 * 60 * 1000;

const itemKey = (name, category) => `${(category || '').toLowerCase()}::${(name || '').toLowerCase()}`;

export function buildItemStats(events, { now = Date.now() } = {}) {
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
        added: 0,
        checked: 0,
        unchecked: 0,
        removed: 0,
        firstTs: e.ts,
        lastTs: e.ts,
        lastCheckedTs: null,
        lastAddedTs: null,
        sources: { typed: 0, quickAdd: 0, other: 0 },
        users: new Set(),
      };
      stats.set(key, s);
    }
    if (e.ts < s.firstTs) s.firstTs = e.ts;
    if (e.ts > s.lastTs) s.lastTs = e.ts;
    if (e.uid) s.users.add(e.uid);
    if (e.action === 'added') {
      s.added++;
      s.lastAddedTs = Math.max(s.lastAddedTs || 0, e.ts);
      if (e.source === 'typed') s.sources.typed++;
      else if (e.source === 'quickAdd') s.sources.quickAdd++;
      else s.sources.other++;
    } else if (e.action === 'checked') {
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

/** Quick-add items not added in the last N days — candidates for demotion. */
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

/** Items the user has typed-added repeatedly that aren't already in the quick-add list — promotion candidates. */
export function promotionCandidates(events, commonItemsByCategory, { minAdds = 3, withinDays = 42, now = Date.now() } = {}) {
  const since = now - withinDays * DAY_MS;
  const counts = new Map();
  for (const e of events) {
    if (e.action !== 'added' || e.source !== 'typed') continue;
    if (e.ts < since) continue;
    const key = itemKey(e.name, e.category);
    let c = counts.get(key);
    if (!c) {
      c = { name: e.name, category: e.category, count: 0, lastTs: e.ts };
      counts.set(key, c);
    }
    c.count++;
    if (e.ts > c.lastTs) c.lastTs = e.ts;
  }
  const inQuickAdd = new Set();
  for (const [category, items] of Object.entries(commonItemsByCategory || {})) {
    for (const item of items || []) inQuickAdd.add(itemKey(item.name, category));
  }
  return Array.from(counts.entries())
    .filter(([key, c]) => c.count >= minAdds && !inQuickAdd.has(key))
    .map(([, c]) => c)
    .sort((a, b) => b.count - a.count);
}

/** Per-user contribution split: who added what, who checked off what. */
export function userContributions(events) {
  const users = new Map();
  for (const e of events) {
    if (!e.uid) continue;
    let u = users.get(e.uid);
    if (!u) {
      u = { uid: e.uid, added: 0, checked: 0, removed: 0 };
      users.set(e.uid, u);
    }
    if (e.action === 'added') u.added++;
    else if (e.action === 'checked') u.checked++;
    else if (e.action === 'removed') u.removed++;
  }
  return Array.from(users.values()).sort((a, b) => (b.added + b.checked) - (a.added + a.checked));
}

/** Summary counters across the full event stream. */
export function eventSummary(events) {
  const out = { total: events.length, added: 0, checked: 0, unchecked: 0, removed: 0, typed: 0, quickAdd: 0, firstTs: null, lastTs: null };
  for (const e of events) {
    out[e.action] = (out[e.action] || 0) + 1;
    if (e.source === 'typed') out.typed++;
    else if (e.source === 'quickAdd') out.quickAdd++;
    if (out.firstTs === null || e.ts < out.firstTs) out.firstTs = e.ts;
    if (out.lastTs === null || e.ts > out.lastTs) out.lastTs = e.ts;
  }
  return out;
}
