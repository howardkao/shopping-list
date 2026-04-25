import { describe, it, expect } from 'vitest';
import {
  purchaseIdentityKey,
  computeEffectiveCheckEvents,
  eventMatchesPurchaseQuery,
  lastEffectivePurchaseTimestamp,
  PURCHASE_UNDO_WINDOW_MS,
} from '../src/purchaseSemantics.js';

const T = 1_000_000; // arbitrary base timestamp

describe('purchaseIdentityKey', () => {
  it('prefers itemKey when present', () => {
    expect(purchaseIdentityKey({ itemKey: 'k1', name: 'apples', category: 'FRUIT' })).toBe('k:k1');
  });

  it('falls back to name+category when itemKey absent', () => {
    expect(purchaseIdentityKey({ name: 'Apples', category: 'Fruit' })).toBe('n:fruit::apples');
  });

  it('falls back when itemKey is blank', () => {
    expect(purchaseIdentityKey({ itemKey: '   ', name: 'Apples', category: 'Fruit' })).toBe('n:fruit::apples');
  });

  it('handles null event gracefully', () => {
    expect(purchaseIdentityKey(null)).toBe('n:::');
  });

  it('handles undefined event gracefully', () => {
    expect(purchaseIdentityKey(undefined)).toBe('n:::');
  });
});

describe('computeEffectiveCheckEvents', () => {
  it('returns empty array for null/undefined/empty input', () => {
    expect(computeEffectiveCheckEvents(null)).toEqual([]);
    expect(computeEffectiveCheckEvents(undefined)).toEqual([]);
    expect(computeEffectiveCheckEvents([])).toEqual([]);
  });

  it('ignores non-check/uncheck actions', () => {
    const events = [
      { action: 'added', ts: T, name: 'apples', category: 'FRUIT' },
      { action: 'removed', ts: T, name: 'apples', category: 'FRUIT' },
    ];
    expect(computeEffectiveCheckEvents(events)).toHaveLength(0);
  });

  it('ignores events without a numeric ts', () => {
    const events = [
      { action: 'checked', name: 'apples', category: 'FRUIT' },          // no ts
      { action: 'checked', ts: 'bad', name: 'apples', category: 'FRUIT' }, // non-numeric ts
    ];
    expect(computeEffectiveCheckEvents(events)).toHaveLength(0);
  });

  it('keeps a lone checked event', () => {
    const e = { action: 'checked', ts: T, name: 'apples', category: 'FRUIT' };
    const result = computeEffectiveCheckEvents([e]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(e); // same object reference
  });

  it('voids checked when unchecked arrives within the undo window', () => {
    const events = [
      { action: 'checked', ts: T, name: 'apples', category: 'FRUIT' },
      { action: 'unchecked', ts: T + 60_000, name: 'apples', category: 'FRUIT' }, // 1 min < 2 hr window
    ];
    expect(computeEffectiveCheckEvents(events)).toHaveLength(0);
  });

  it('keeps checked when unchecked arrives exactly at the window boundary (> not <=)', () => {
    const events = [
      { action: 'checked', ts: T, name: 'apples', category: 'FRUIT' },
      { action: 'unchecked', ts: T + PURCHASE_UNDO_WINDOW_MS + 1, name: 'apples', category: 'FRUIT' },
    ];
    expect(computeEffectiveCheckEvents(events)).toHaveLength(1);
  });

  it('LIFO: one uncheck voids only the most recent check', () => {
    const check1 = { action: 'checked', ts: T, name: 'apples', category: 'FRUIT' };
    const check2 = { action: 'checked', ts: T + 1000, name: 'apples', category: 'FRUIT' };
    const uncheck = { action: 'unchecked', ts: T + 2000, name: 'apples', category: 'FRUIT' };
    const result = computeEffectiveCheckEvents([check1, check2, uncheck]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(check1);
  });

  it('handles two distinct items independently', () => {
    const events = [
      { action: 'checked', ts: T, name: 'apples', category: 'FRUIT' },
      { action: 'checked', ts: T, name: 'milk', category: 'DAIRY' },
      { action: 'unchecked', ts: T + 1000, name: 'apples', category: 'FRUIT' }, // voids apples only
    ];
    const result = computeEffectiveCheckEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('milk');
  });

  it('uses itemKey for identity even when categories differ', () => {
    // item moved categories between checks — itemKey groups them correctly
    const check = { action: 'checked', ts: T, name: 'bananas', category: 'FRUIT', itemKey: 'k1' };
    const uncheck = { action: 'unchecked', ts: T + 1000, name: 'bananas', category: 'PRODUCE', itemKey: 'k1' };
    expect(computeEffectiveCheckEvents([check, uncheck])).toHaveLength(0);
  });

  it('respects a custom undoWindowMs option', () => {
    const events = [
      { action: 'checked', ts: T, name: 'apples', category: 'FRUIT' },
      { action: 'unchecked', ts: T + 500, name: 'apples', category: 'FRUIT' },
    ];
    // window of 100ms → 500ms exceeds it → check survives
    expect(computeEffectiveCheckEvents(events, { undoWindowMs: 100 })).toHaveLength(1);
    // window of 1000ms → 500ms within it → check voided
    expect(computeEffectiveCheckEvents(events, { undoWindowMs: 1000 })).toHaveLength(0);
  });
});

describe('eventMatchesPurchaseQuery', () => {
  const e = { name: 'apples', category: 'FRUIT', itemKey: 'k1', categoryId: 'cat1' };

  it('returns false when name mismatches (case-insensitive)', () => {
    expect(eventMatchesPurchaseQuery(e, { name: 'oranges' })).toBe(false);
  });

  it('returns true when name matches and query has no itemKey', () => {
    expect(eventMatchesPurchaseQuery(e, { name: 'Apples' })).toBe(true);
  });

  it('returns true when name and itemKey both match', () => {
    expect(eventMatchesPurchaseQuery(e, { name: 'apples', itemKey: 'k1' })).toBe(true);
  });

  it('returns false when itemKeys both present but mismatch', () => {
    const eDiff = { name: 'apples', category: 'FRUIT', itemKey: 'k99' };
    expect(eventMatchesPurchaseQuery(eDiff, { name: 'apples', itemKey: 'k1' })).toBe(false);
  });

  it('legacy fallback: event without itemKey matched by categoryName', () => {
    const eLegacy = { name: 'apples', category: 'FRUIT' };
    expect(eventMatchesPurchaseQuery(eLegacy, { name: 'apples', itemKey: 'k1', categoryName: 'FRUIT' })).toBe(true);
  });

  it('legacy fallback: rejected when categoryName mismatches', () => {
    const eLegacy = { name: 'apples', category: 'PRODUCE' };
    expect(eventMatchesPurchaseQuery(eLegacy, { name: 'apples', itemKey: 'k1', categoryName: 'FRUIT' })).toBe(false);
  });

  it('legacy fallback: rejected when categoryId mismatches', () => {
    const eLegacy = { name: 'apples', category: 'FRUIT', categoryId: 'cat99' };
    expect(eventMatchesPurchaseQuery(eLegacy, { name: 'apples', itemKey: 'k1', categoryName: 'FRUIT', categoryId: 'cat1' })).toBe(false);
  });
});

describe('lastEffectivePurchaseTimestamp', () => {
  it('returns null when no events', () => {
    expect(lastEffectivePurchaseTimestamp([], { name: 'apples' })).toBeNull();
  });

  it('returns null when all checks are voided', () => {
    const events = [
      { action: 'checked', ts: T, name: 'apples', category: 'FRUIT' },
      { action: 'unchecked', ts: T + 1000, name: 'apples', category: 'FRUIT' },
    ];
    expect(lastEffectivePurchaseTimestamp(events, { name: 'apples' })).toBeNull();
  });

  it('returns the latest surviving check timestamp', () => {
    const events = [
      { action: 'checked', ts: T, name: 'apples', category: 'FRUIT' },
      { action: 'checked', ts: T + 5000, name: 'apples', category: 'FRUIT' },
    ];
    expect(lastEffectivePurchaseTimestamp(events, { name: 'apples' })).toBe(T + 5000);
  });

  it('ignores events for different items', () => {
    const events = [
      { action: 'checked', ts: T, name: 'milk', category: 'DAIRY' },
    ];
    expect(lastEffectivePurchaseTimestamp(events, { name: 'apples' })).toBeNull();
  });
});
