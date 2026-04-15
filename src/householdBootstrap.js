// Seed a brand-new household with the default aisle/category/item taxonomy.
//
// Intended to run once, at household creation. Idempotent: if
// `migration/taxonomy_v2` is already set, we leave everything alone. The same
// flag is set by the legacy migration script, so a household created before
// taxonomy v2 won't be re-seeded here.

import {
  ref, get, set, push, update, serverTimestamp,
} from 'firebase/database';
import { database } from './firebase';
import { SEED_AISLES, SEED_CATEGORIES, SEED_ITEMS } from './seedCatalog';

export async function bootstrapHouseholdTaxonomy(householdId) {
  if (!householdId) throw new Error('bootstrapHouseholdTaxonomy: householdId required');

  const flagRef = ref(database, `households/${householdId}/taxonomy/migrated`);
  const flagSnap = await get(flagRef);
  if (flagSnap.exists() && flagSnap.val() === true) {
    return { seeded: false, reason: 'already-migrated' };
  }

  // Assign fresh Firebase push ids to every seed record. Slugs in the seed
  // catalog are only for internal cross-references; they never land in the DB.
  const aisleIdBySlug = {};
  const aislesOut = {};
  SEED_AISLES.forEach((a, idx) => {
    const id = push(ref(database, `households/${householdId}/taxonomy/aisles`)).key;
    aisleIdBySlug[a.id] = id;
    aislesOut[id] = { name: a.name, order: idx };
  });

  const categoryIdBySlug = {};
  const categoriesOut = {};
  for (const c of SEED_CATEGORIES) {
    const id = push(ref(database, `households/${householdId}/taxonomy/categories`)).key;
    categoryIdBySlug[c.id] = id;
    categoriesOut[id] = {
      name: c.name,
      aisleId: aisleIdBySlug[c.aisleId],
      hidden: false,
    };
  }

  const visibleOut = {}; // { [catId]: Array<{id, name}> }
  const libraryOut = {}; // { [catId]: Array<{id, name}> }
  for (const item of SEED_ITEMS) {
    const catId = categoryIdBySlug[item.categoryId];
    if (!catId) continue; // defensive: malformed seed
    const bucket = item.starred ? visibleOut : libraryOut;
    if (!bucket[catId]) bucket[catId] = [];
    const itemId = push(ref(database, `households/${householdId}/taxonomy/visible-items/${catId}`)).key;
    bucket[catId].push({ id: itemId, name: item.name });
  }

  // Single multi-path update for atomicity. If any rule rejects, nothing is written.
  const updates = {
    [`households/${householdId}/taxonomy/aisles`]: aislesOut,
    [`households/${householdId}/taxonomy/categories`]: categoriesOut,
    [`households/${householdId}/taxonomy/migrated`]: true,
    [`households/${householdId}/taxonomy/migrated_at`]: serverTimestamp(),
    [`households/${householdId}/taxonomy/onboarding_completed`]: false,
  };
  for (const [catId, items] of Object.entries(visibleOut)) {
    updates[`households/${householdId}/taxonomy/visible-items/${catId}`] = items;
  }
  for (const [catId, items] of Object.entries(libraryOut)) {
    updates[`households/${householdId}/taxonomy/library/${catId}`] = items;
  }

  await update(ref(database), updates);

  return {
    seeded: true,
    counts: {
      aisles: Object.keys(aislesOut).length,
      categories: Object.keys(categoriesOut).length,
      visibleCategories: Object.keys(visibleOut).length,
      libraryCategories: Object.keys(libraryOut).length,
      visibleItems: Object.values(visibleOut).reduce((n, a) => n + a.length, 0),
      libraryItems: Object.values(libraryOut).reduce((n, a) => n + a.length, 0),
    },
  };
}
