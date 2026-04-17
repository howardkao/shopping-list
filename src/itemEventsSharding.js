/**
 * Household item-events: monthly shards + small index for download-friendly sync.
 * Legacy flat `households/{hid}/item-events` is still read and merged for old data.
 */
import { ref, get, update, push } from 'firebase/database';
import { loadItemEventsBucketCache, saveItemEventsBucketCache } from './offlineStorage';

/** Local calendar month key (YYYY-MM), matches how users think about "this month". */
export function eventMonthKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

function isValidMonthKey(m) {
  return typeof m === 'string' && MONTH_KEY_RE.test(m);
}

function flattenBucketToEvents(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.filter((e) => e && typeof e.ts === 'number');
  if (typeof raw === 'object') {
    return Object.values(raw).filter((e) => e && typeof e.ts === 'number');
  }
  return [];
}

/**
 * Append one item event (writes under item-events-by-month + bumps index).
 */
export async function pushHouseholdItemEvent(database, householdId, payload) {
  const ts = typeof payload.ts === 'number' ? payload.ts : Date.now();
  const month = eventMonthKey(ts);
  const bucketRef = ref(database, `households/${householdId}/item-events-by-month/${month}`);
  const newRef = push(bucketRef);
  const key = newRef.key;
  const payloadWithTs = { ...payload, ts };
  await update(ref(database), {
    [`households/${householdId}/item-events-by-month/${month}/${key}`]: payloadWithTs,
    [`households/${householdId}/item-events-index/${month}/updatedAt`]: ts,
  });
}

/**
 * Load all item events for a household: legacy flat node + monthly shards.
 * Uses IndexedDB per month when `item-events-index/{month}/updatedAt` matches cache.
 *
 * @param {import('firebase/database').Database} database
 * @param {string} householdId
 * @param {{ liveBucketMonthKey?: string | null, liveBucketVal?: object | null }} [options]
 *        When the UI keeps an `onValue` on the current month bucket, pass its month key
 *        and snapshot `.val()` so we do not rely on a stale IDB/network fetch for that month.
 */
export async function getHouseholdItemEventsMerged(database, householdId, options = {}) {
  const { liveBucketMonthKey = null, liveBucketVal = null } = options;

  const base = `households/${householdId}`;
  const [indexSnap, legacySnap] = await Promise.all([
    get(ref(database, `${base}/item-events-index`)),
    get(ref(database, `${base}/item-events`)),
  ]);

  const index = indexSnap.val() || {};
  const legacyRaw = legacySnap.val() || {};
  const legacyEvents = Object.values(legacyRaw).filter((e) => e && typeof e.ts === 'number');

  const nowMonth = eventMonthKey(Date.now());
  const monthSet = new Set([nowMonth]);
  for (const k of Object.keys(index)) {
    if (isValidMonthKey(k)) monthSet.add(k);
  }

  const months = [...monthSet].sort();

  const perMonthEvents = await Promise.all(
    months.map(async (m) => {
      const idxEntry = index[m];
      const idxUpdated = idxEntry && typeof idxEntry.updatedAt === 'number' ? idxEntry.updatedAt : null;

      if (
        liveBucketMonthKey &&
        m === liveBucketMonthKey &&
        liveBucketVal != null
      ) {
        return flattenBucketToEvents(liveBucketVal);
      }

      try {
        const cached = await loadItemEventsBucketCache(householdId, m);
        if (
          cached &&
          cached.bucketVal &&
          idxUpdated != null &&
          cached.indexUpdatedAt === idxUpdated
        ) {
          return flattenBucketToEvents(cached.bucketVal);
        }
      } catch {
        /* ignore cache read errors */
      }

      const snap = await get(ref(database, `${base}/item-events-by-month/${m}`));
      const raw = snap.val() || {};
      try {
        await saveItemEventsBucketCache(householdId, m, {
          indexUpdatedAt: idxUpdated,
          bucketVal: raw,
        });
      } catch {
        /* ignore cache write errors */
      }
      return flattenBucketToEvents(raw);
    })
  );

  const merged = [...legacyEvents, ...perMonthEvents.flat()];
  merged.sort((a, b) => a.ts - b.ts);
  return merged;
}
