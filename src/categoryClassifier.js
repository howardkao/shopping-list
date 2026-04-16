// Category classifier — maps categories to perishability tiers and returns
// promotion/dormancy thresholds appropriate for each.
//
// Three resolution strategies, tried in order:
//   1. Exact seed-ID lookup (fast, covers default taxonomy)
//   2. Keyword scan against the category display name (handles power-user renames)
//   3. Fallback to 'default' tier

// --- Tier definitions ---

export const TIERS = {
  fresh:    { promotionChecks: 3, promotionDays: 21, dormantDays: 21,  minEventAge: 21  },
  packaged: { promotionChecks: 3, promotionDays: 21, dormantDays: 35,  minEventAge: 35  },
  pantry:   { promotionChecks: 3, promotionDays: 42, dormantDays: 70,  minEventAge: 70  },
  nonfood:  { promotionChecks: 3, promotionDays: 42, dormantDays: 90,  minEventAge: 90  },
  default:  { promotionChecks: 3, promotionDays: 42, dormantDays: 90,  minEventAge: 90  },
};

// --- Seed-ID → tier mapping (covers all SEED_CATEGORIES from seedCatalog.js) ---

const TIER_BY_SEED_ID = {
  // Produce
  'fruit': 'fresh', 'vegetable': 'fresh', 'fresh-herbs': 'fresh',
  // Meat & Seafood
  'beef': 'fresh', 'poultry': 'fresh', 'pork': 'fresh', 'seafood': 'fresh',
  'deli-meat': 'fresh', 'plant-protein': 'fresh',
  // Dairy & Eggs
  'milk-cream': 'fresh', 'cheese': 'fresh', 'yogurt': 'fresh',
  'butter-dairy-spreads': 'fresh', 'eggs': 'fresh',
  // Prepared Foods & Bakery
  'deli-prepared': 'fresh',
  'breads-tortillas': 'fresh',
  'pastries-desserts': 'fresh', 'rotisserie-hotbar': 'fresh',
  'sushi-sandwiches': 'fresh',

  // Frozen
  'frozen-meals': 'packaged', 'frozen-produce': 'packaged',
  'frozen-meat-seafood': 'packaged', 'ice-cream-desserts': 'packaged',
  'frozen-breakfast': 'packaged',
  // Packaged Foods
  'beverages': 'packaged', 'snacks': 'packaged', 'canned-goods': 'packaged',
  'condiments-sauces': 'packaged', 'pasta-grains': 'packaged',
  'cereal-breakfast': 'packaged', 'soups-broths': 'packaged',
  'latin-foods': 'packaged', 'east-asian-foods': 'packaged',
  'southeast-asian-foods': 'packaged', 'kosher-foods': 'packaged',

  // Baking, Spices & Oils
  'baking': 'pantry', 'spices-seasonings': 'pantry',
  'oils-vinegars': 'pantry', 'sweeteners': 'pantry',

  // Personal Care & Pharmacy
  'otc-meds': 'nonfood', 'vitamins-supplements': 'nonfood',
  'first-aid': 'nonfood', 'oral-care': 'nonfood',
  'hair-skin': 'nonfood', 'shaving-grooming': 'nonfood',
  'feminine-care': 'nonfood',
  // Household & Bulk
  'cleaning': 'nonfood', 'paper-goods': 'nonfood', 'laundry': 'nonfood',
  'kitchen-consumables': 'nonfood', 'pet': 'nonfood',
  'batteries-bulbs': 'nonfood', 'storage-organization': 'nonfood',
  'baby': 'nonfood',
};

// --- Keyword → tier (for power-user renames / custom categories) ---
// Each entry is [tier, [...keywords]]. First match wins, so order matters:
// fresh before packaged (both could match "frozen produce" — "produce" hits fresh
// but we want frozen to win, so packaged keywords are checked first for "frozen").

const KEYWORD_RULES = [
  // Packaged checked before fresh so "frozen" wins over "produce/meat" substrings
  ['packaged', [
    'frozen', 'canned', 'packaged', 'snack', 'beverage', 'drink', 'soda', 'juice',
    'cereal', 'pasta', 'grain', 'noodle', 'rice', 'condiment', 'sauce',
    'soup', 'broth', 'ice cream', 'latin', 'hispanic', 'asian', 'kosher',
  ]],
  ['fresh', [
    'fruit', 'veggie', 'vegetable', 'produce', 'meat', 'poultry', 'chicken',
    'beef', 'pork', 'lamb', 'fish', 'seafood', 'shrimp', 'salmon',
    'deli', 'dairy', 'milk', 'cream', 'cheese', 'yogurt', 'yoghurt', 'butter',
    'egg', 'bread', 'bakery', 'fresh', 'herb', 'sushi', 'sandwich',
    'tortilla', 'flatbread', 'rotisserie', 'pastry', 'pastries',
  ]],
  ['pantry', [
    'spice', 'seasoning', 'oil', 'vinegar', 'baking', 'flour', 'sugar',
    'sweetener', 'honey', 'syrup', 'extract',
  ]],
  ['nonfood', [
    'medicine', 'med', 'pharmacy', 'pharmaceutical', 'vitamin', 'supplement',
    'first aid', 'oral', 'dental', 'tooth', 'hair', 'skin', 'body wash',
    'shav', 'groom', 'feminine', 'menstrual', 'clean', 'detergent',
    'paper towel', 'toilet paper', 'tissue', 'napkin', 'paper good',
    'laundry', 'kitchen', 'pet', 'dog', 'cat', 'battery', 'bulb', 'light',
    'baby', 'diaper', 'wipe', 'formula', 'household', 'storage',
  ]],
];

/**
 * Classify a category into a perishability tier.
 *
 * @param {string} categoryName — the display name of the category
 * @param {string|null} seedId — the seed slug (if the taxonomy tracks legacy IDs)
 * @returns {'fresh'|'packaged'|'pantry'|'nonfood'|'default'}
 */
export function classifyCategory(categoryName, seedId = null) {
  // 1. Exact seed-ID lookup
  if (seedId && TIER_BY_SEED_ID[seedId]) return TIER_BY_SEED_ID[seedId];

  // 2. Keyword scan on the display name
  if (categoryName) {
    const lower = categoryName.toLowerCase();
    for (const [tier, keywords] of KEYWORD_RULES) {
      for (const kw of keywords) {
        if (lower.includes(kw)) return tier;
      }
    }
  }

  // 3. Fallback
  return 'default';
}

/**
 * Get promotion and dormancy thresholds for a category.
 *
 * @param {string} categoryName
 * @param {string|null} seedId
 * @returns {{ promotionChecks: number, promotionDays: number, dormantDays: number, tier: string }}
 */
export function getThresholds(categoryName, seedId = null) {
  const tier = classifyCategory(categoryName, seedId);
  return { ...TIERS[tier], tier };
}

/**
 * Build a lookup: categoryId → thresholds, using the taxonomy's categoriesV2 map.
 * categoriesV2 shape: { [categoryId]: { name, aisleId, ... } }
 *
 * @param {Record<string, {name: string}>} categoriesV2
 * @returns {Record<string, {promotionChecks: number, promotionDays: number, dormantDays: number, tier: string}>}
 */
export function buildThresholdsMap(categoriesV2) {
  const out = {};
  for (const [catId, cat] of Object.entries(categoriesV2 || {})) {
    // The seed ID is the catId itself if it matches a known seed slug; otherwise null.
    const seedId = TIER_BY_SEED_ID[catId] ? catId : null;
    out[catId] = getThresholds(cat?.name || '', seedId);
  }
  return out;
}
