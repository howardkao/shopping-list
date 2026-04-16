// Purchase semantics over item-events: which `checked` events count as real buys.
//
// Raw `checked` / `unchecked` pairs model shop-mode taps. A quick check followed by
// an uncheck (accident + correction) should not pollute purchase history, shortcut
// promotion/demotion, or "last purchased" UI.

/** If `unchecked` arrives within this window after the most recent unmatched `checked`, that check is voided (LIFO). */
export const PURCHASE_UNDO_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * Grouping key for pairing check ↔ uncheck. Prefer list `itemKey` when present on events.
 * @param {{ name?: string, category?: string, itemKey?: string }} e
 */
export function purchaseIdentityKey(e) {
  if (e && e.itemKey != null && String(e.itemKey).trim() !== '') {
    return `k:${String(e.itemKey)}`;
  }
  const name = (e?.name || '').toLowerCase();
  const cat = (e?.category || '').toLowerCase();
  return `n:${cat}::${name}`;
}

/**
 * LIFO rule per identity: each `unchecked` pops the latest unmatched `checked` only when
 * `unchecked.ts - checked.ts <= undoWindowMs`. Returns surviving `checked` events (same
 * object references as in `events` where possible).
 * @param {Array<object>} events
 * @param {{ undoWindowMs?: number }} [opts]
 * @returns {object[]}
 */
export function computeEffectiveCheckEvents(events, { undoWindowMs = PURCHASE_UNDO_WINDOW_MS } = {}) {
  if (!events?.length) return [];
  const relevant = events.filter(
    e => e && typeof e.ts === 'number' && (e.action === 'checked' || e.action === 'unchecked'),
  );
  const byKey = new Map();
  for (const e of relevant) {
    const k = purchaseIdentityKey(e);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(e);
  }
  const survivors = [];
  for (const [, group] of byKey) {
    group.sort((a, b) => {
      const d = a.ts - b.ts;
      if (d !== 0) return d;
      if (a.action === b.action) return 0;
      return a.action === 'checked' ? -1 : 1;
    });
    const stack = [];
    for (const e of group) {
      if (e.action === 'checked') {
        stack.push(e);
      } else if (e.action === 'unchecked' && stack.length) {
        const top = stack[stack.length - 1];
        if (e.ts - top.ts <= undoWindowMs) stack.pop();
      }
    }
    survivors.push(...stack);
  }
  return survivors;
}

/**
 * Whether an effective check `e` should count toward a bottom-sheet row / suggestion.
 * @param {object} e — a check event from `computeEffectiveCheckEvents`
 * @param {{ name: string, itemKey?: string|null, categoryName?: string|null, categoryId?: string|null }} q
 */
export function eventMatchesPurchaseQuery(e, q) {
  const qName = (q.name || '').toLowerCase().trim();
  if ((e.name || '').toLowerCase() !== qName) return false;

  const qKey = q.itemKey != null && String(q.itemKey).trim() !== '' ? String(q.itemKey) : '';
  const eKey = e.itemKey != null && String(e.itemKey).trim() !== '' ? String(e.itemKey) : '';

  if (!qKey) return true;

  if (eKey && eKey === qKey) return true;

  if (!eKey) {
    const qCat = (q.categoryName || '').toLowerCase();
    if (qCat && (e.category || '').toLowerCase() !== qCat) return false;
    const qCatId = q.categoryId != null ? String(q.categoryId) : '';
    if (qCatId && e.categoryId && String(e.categoryId) !== qCatId) return false;
    return true;
  }

  return false;
}

/**
 * Latest timestamp of an effective purchase relevant to `query`.
 * @param {Array<object>} allEvents — full item-events array (checked/unchecked/…)
 * @param {{ name: string, itemKey?: string|null, categoryName?: string|null, categoryId?: string|null }} query
 */
export function lastEffectivePurchaseTimestamp(allEvents, query, opts = {}) {
  const effective = computeEffectiveCheckEvents(allEvents, opts);
  let best = null;
  for (const e of effective) {
    if (eventMatchesPurchaseQuery(e, query)) {
      if (best == null || e.ts > best) best = e.ts;
    }
  }
  return best;
}
