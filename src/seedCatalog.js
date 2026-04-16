// Seed catalog for new households.
//
// Three tiers: aisles → categories → items.
// - Aisles are ordered; order reflects a reasonable default walk through a store.
// - Categories attach to exactly one aisle via aisleId.
// - Items attach to exactly one category via categoryId.
// - `starred: true` items seed into the household's visible (quick-add) set.
//   Unstarred items seed into the library (autocomplete-only).
//
// IDs below are stable slug-style strings. At household-seed time, the migration
// code maps these slugs to freshly-minted Firebase push IDs and writes the data
// under /households/{hid}/{aisles,categories,visible-items,library}.

export const SEED_AISLES = [
  { id: 'produce',             name: 'Produce' },
  { id: 'meat-seafood',        name: 'Meat & Seafood' },
  { id: 'deli-dairy-eggs',     name: 'Deli, Dairy & Eggs' },
  { id: 'frozen',              name: 'Frozen' },
  { id: 'packaged-foods',      name: 'Packaged Foods' },
  { id: 'baking-spices-oils',  name: 'Baking, Spices & Oils' },
  { id: 'bakery-prepared',     name: 'Prepared Foods & Bakery' },
  { id: 'pharmacy-personal',   name: 'Personal Care & Pharmacy' },
  { id: 'household-bulk',      name: 'Household & Bulk' },
];

export const SEED_CATEGORIES = [
  // PRODUCE
  { id: 'fruit',              aisleId: 'produce',            name: 'Fruit' },
  { id: 'vegetable',          aisleId: 'produce',            name: 'Vegetable' },
  { id: 'fresh-herbs',        aisleId: 'produce',            name: 'Fresh herbs' },

  // MEAT & SEAFOOD
  { id: 'beef',               aisleId: 'meat-seafood',       name: 'Beef' },
  { id: 'poultry',            aisleId: 'meat-seafood',       name: 'Poultry' },
  { id: 'pork',               aisleId: 'meat-seafood',       name: 'Pork' },
  { id: 'seafood',            aisleId: 'meat-seafood',       name: 'Seafood' },
  { id: 'deli-meat',          aisleId: 'meat-seafood',       name: 'Deli meat' },
  { id: 'plant-protein',      aisleId: 'meat-seafood',       name: 'Plant-based protein' },

  // DELI, DAIRY & EGGS
  { id: 'milk-cream',         aisleId: 'deli-dairy-eggs',    name: 'Milk & cream' },
  { id: 'cheese',             aisleId: 'deli-dairy-eggs',    name: 'Cheese' },
  { id: 'yogurt',             aisleId: 'deli-dairy-eggs',    name: 'Yogurt' },
  { id: 'butter-spreads',     aisleId: 'deli-dairy-eggs',    name: 'Butter & spreads' },
  { id: 'eggs',               aisleId: 'deli-dairy-eggs',    name: 'Eggs' },
  { id: 'deli-prepared',      aisleId: 'deli-dairy-eggs',    name: 'Deli prepared' },

  // FROZEN
  { id: 'frozen-meals',       aisleId: 'frozen',             name: 'Frozen meals' },
  { id: 'frozen-produce',     aisleId: 'frozen',             name: 'Frozen produce' },
  { id: 'frozen-meat-seafood',aisleId: 'frozen',             name: 'Frozen meat & seafood' },
  { id: 'ice-cream-desserts', aisleId: 'frozen',             name: 'Ice cream & desserts' },
  { id: 'frozen-breakfast',   aisleId: 'frozen',             name: 'Frozen breakfast' },

  // PACKAGED FOODS
  { id: 'beverages',          aisleId: 'packaged-foods',     name: 'Beverages' },
  { id: 'snacks',             aisleId: 'packaged-foods',     name: 'Snacks' },
  { id: 'canned-goods',       aisleId: 'packaged-foods',     name: 'Canned goods' },
  { id: 'condiments-sauces',  aisleId: 'packaged-foods',     name: 'Condiments & sauces' },
  { id: 'pasta-grains',       aisleId: 'packaged-foods',     name: 'Pasta & grains' },
  { id: 'cereal-breakfast',   aisleId: 'packaged-foods',     name: 'Cereal & breakfast' },
  { id: 'soups-broths',       aisleId: 'packaged-foods',     name: 'Soups & broths' },
  { id: 'international',      aisleId: 'packaged-foods',     name: 'International' },

  // BAKING, SPICES & OILS
  { id: 'baking',             aisleId: 'baking-spices-oils', name: 'Baking' },
  { id: 'spices-seasonings',  aisleId: 'baking-spices-oils', name: 'Spices & seasonings' },
  { id: 'oils-vinegars',      aisleId: 'baking-spices-oils', name: 'Oils & vinegars' },
  { id: 'sweeteners',         aisleId: 'baking-spices-oils', name: 'Sweeteners' },

  // PREPARED FOODS & BAKERY
  { id: 'bread-rolls',        aisleId: 'bakery-prepared',    name: 'Bread & rolls' },
  { id: 'tortillas-flatbreads', aisleId: 'bakery-prepared',  name: 'Tortillas & flatbreads' },
  { id: 'pastries-desserts',  aisleId: 'bakery-prepared',    name: 'Pastries & desserts' },
  { id: 'rotisserie-hotbar',  aisleId: 'bakery-prepared',    name: 'Rotisserie & hot bar' },
  { id: 'sushi-sandwiches',   aisleId: 'bakery-prepared',    name: 'Sushi & sandwiches' },

  // PERSONAL CARE & PHARMACY
  { id: 'otc-meds',           aisleId: 'pharmacy-personal',  name: 'OTC meds' },
  { id: 'vitamins-supplements', aisleId: 'pharmacy-personal',name: 'Vitamins & supplements' },
  { id: 'first-aid',          aisleId: 'pharmacy-personal',  name: 'First aid' },
  { id: 'oral-care',          aisleId: 'pharmacy-personal',  name: 'Oral care' },
  { id: 'hair-skin',          aisleId: 'pharmacy-personal',  name: 'Hair & skin' },
  { id: 'shaving-grooming',   aisleId: 'pharmacy-personal',  name: 'Shaving & grooming' },
  { id: 'feminine-care',      aisleId: 'pharmacy-personal',  name: 'Feminine care' },

  // HOUSEHOLD & BULK
  { id: 'cleaning',           aisleId: 'household-bulk',     name: 'Cleaning' },
  { id: 'paper-goods',        aisleId: 'household-bulk',     name: 'Paper goods' },
  { id: 'laundry',            aisleId: 'household-bulk',     name: 'Laundry' },
  { id: 'kitchen-consumables',aisleId: 'household-bulk',     name: 'Kitchen consumables' },
  { id: 'pet',                aisleId: 'household-bulk',     name: 'Pet' },
  { id: 'batteries-bulbs',    aisleId: 'household-bulk',     name: 'Batteries & light bulbs' },
  { id: 'storage-organization',aisleId: 'household-bulk',    name: 'Storage & organization' },
  { id: 'baby',               aisleId: 'household-bulk',     name: 'Baby' },
];

// Items are { categoryId, name, starred }.
// `starred: true` seeds into the household's visible set on first setup.
// Unstarred items seed into the library (autocomplete only).
export const SEED_ITEMS = [
  // --- PRODUCE ---
  // fruit
  { categoryId: 'fruit', name: 'bananas',    starred: true  },
  { categoryId: 'fruit', name: 'apples',     starred: true  },
  { categoryId: 'fruit', name: 'strawberries', starred: true  },
  { categoryId: 'fruit', name: 'lemons',     starred: false },
  { categoryId: 'fruit', name: 'avocados',    starred: false },
  { categoryId: 'fruit', name: 'blueberries', starred: false },
  { categoryId: 'fruit', name: 'raspberries', starred: false },
  { categoryId: 'fruit', name: 'grapes',      starred: false },
  { categoryId: 'fruit', name: 'oranges',     starred: true  },
  { categoryId: 'fruit', name: 'limes',       starred: false },
  { categoryId: 'fruit', name: 'pineapples',  starred: false },
  { categoryId: 'fruit', name: 'watermelons', starred: false },
  { categoryId: 'fruit', name: 'mangoes',     starred: false },

  // vegetable
  { categoryId: 'vegetable', name: 'onions',        starred: true  },
  { categoryId: 'vegetable', name: 'garlic',        starred: false },
  { categoryId: 'vegetable', name: 'tomatoes',      starred: true  },
  { categoryId: 'vegetable', name: 'carrots',       starred: true  },
  { categoryId: 'vegetable', name: 'potatoes',      starred: true  },
  { categoryId: 'vegetable', name: 'spinach',       starred: false },
  { categoryId: 'vegetable', name: 'bell peppers',  starred: false },
  { categoryId: 'vegetable', name: 'broccoli',      starred: false },
  { categoryId: 'vegetable', name: 'cucumbers',     starred: false },
  { categoryId: 'vegetable', name: 'lettuce',       starred: true  },
  { categoryId: 'vegetable', name: 'celery',        starred: false },
  { categoryId: 'vegetable', name: 'zucchini',      starred: false },
  { categoryId: 'vegetable', name: 'sweet potatoes', starred: false },
  { categoryId: 'vegetable', name: 'mushrooms',     starred: false },
  { categoryId: 'vegetable', name: 'corn',          starred: false },
  { categoryId: 'vegetable', name: 'cauliflower',   starred: false },
  { categoryId: 'vegetable', name: 'green onions',  starred: false },
  { categoryId: 'vegetable', name: 'kale',          starred: false },
  { categoryId: 'vegetable', name: 'ginger',        starred: false },

  // fresh herbs
  { categoryId: 'fresh-herbs', name: 'cilantro', starred: false },
  { categoryId: 'fresh-herbs', name: 'parsley',  starred: false },
  { categoryId: 'fresh-herbs', name: 'basil',    starred: false },
  { categoryId: 'fresh-herbs', name: 'mint',     starred: false },
  { categoryId: 'fresh-herbs', name: 'rosemary', starred: false },
  { categoryId: 'fresh-herbs', name: 'thyme',    starred: false },
  { categoryId: 'fresh-herbs', name: 'dill',     starred: false },

  // --- MEAT & SEAFOOD ---
  // beef
  { categoryId: 'beef', name: 'ground beef',      starred: true  },
  { categoryId: 'beef', name: 'chuck roast',      starred: true  },
  { categoryId: 'beef', name: 'brisket',          starred: true  },
  { categoryId: 'beef', name: 'ribeye',           starred: false },
  { categoryId: 'beef', name: 'sirloin',          starred: false },
  { categoryId: 'beef', name: 'stew meat',        starred: false },
  { categoryId: 'beef', name: 'flank steak',      starred: false },
  { categoryId: 'beef', name: 'skirt steak',      starred: false },
  { categoryId: 'beef', name: 'beef short ribs',  starred: false },
  { categoryId: 'beef', name: 'hamburger patties', starred: false },
  { categoryId: 'beef', name: 'beef sausage',     starred: false },
  { categoryId: 'beef', name: 'beef franks',      starred: false },

  // poultry
  { categoryId: 'poultry', name: 'chicken breast', starred: true  },
  { categoryId: 'poultry', name: 'chicken thigh',  starred: false },
  { categoryId: 'poultry', name: 'chicken drumsticks', starred: false },
  { categoryId: 'poultry', name: 'whole chicken',  starred: false },
  { categoryId: 'poultry', name: 'ground turkey',  starred: false },
  { categoryId: 'poultry', name: 'chicken sausage', starred: false },
  { categoryId: 'poultry', name: 'turkey sausage', starred: false },
  { categoryId: 'poultry', name: 'turkey kielbasa', starred: false },

  // pork
  { categoryId: 'pork', name: 'bacon',           starred: true  },
  { categoryId: 'pork', name: 'pork chop',       starred: false },
  { categoryId: 'pork', name: 'pork tenderloin', starred: false },
  { categoryId: 'pork', name: 'sausage',         starred: false },
  { categoryId: 'pork', name: 'Italian sausage', starred: false },
  { categoryId: 'pork', name: 'breakfast sausage', starred: false },
  { categoryId: 'pork', name: 'bratwurst',       starred: false },
  { categoryId: 'pork', name: 'chorizo',         starred: false },
  { categoryId: 'pork', name: 'kielbasa',        starred: false },
  { categoryId: 'pork', name: 'ham',             starred: false },

  // seafood
  { categoryId: 'seafood', name: 'salmon',        starred: true  },
  { categoryId: 'seafood', name: 'shrimp',        starred: true  },
  { categoryId: 'seafood', name: 'cod',           starred: false },
  { categoryId: 'seafood', name: 'tilapia',       starred: false },
  { categoryId: 'seafood', name: 'halibut',       starred: false },
  { categoryId: 'seafood', name: 'trout',         starred: false },
  { categoryId: 'seafood', name: 'catfish',       starred: false },
  { categoryId: 'seafood', name: 'mahi mahi',     starred: false },
  { categoryId: 'seafood', name: 'red snapper',   starred: false },
  { categoryId: 'seafood', name: 'scallops',      starred: false },
  { categoryId: 'seafood', name: 'mussels',       starred: false },
  { categoryId: 'seafood', name: 'clams',         starred: false },
  { categoryId: 'seafood', name: 'oysters',       starred: false },

  // deli meat
  { categoryId: 'deli-meat', name: 'sliced turkey', starred: false },
  { categoryId: 'deli-meat', name: 'sliced ham',    starred: false },
  { categoryId: 'deli-meat', name: 'salami',        starred: false },
  { categoryId: 'deli-meat', name: 'roast beef',    starred: false },

  // plant-based protein
  { categoryId: 'plant-protein', name: 'tofu',                  starred: false },
  { categoryId: 'plant-protein', name: 'tempeh',                starred: false },
  { categoryId: 'plant-protein', name: 'plant-based sausage', starred: false },

  // --- DELI, DAIRY & EGGS ---
  // milk & cream
  { categoryId: 'milk-cream', name: 'milk',          starred: true  },
  { categoryId: 'milk-cream', name: 'heavy cream',   starred: false },
  { categoryId: 'milk-cream', name: 'half-and-half', starred: false },
  { categoryId: 'milk-cream', name: 'oat milk',      starred: false },
  { categoryId: 'milk-cream', name: 'almond milk',   starred: false },

  // cheese
  { categoryId: 'cheese', name: 'cheddar',                 starred: true  },
  { categoryId: 'cheese', name: 'shredded cheddar',       starred: false },
  { categoryId: 'cheese', name: 'sliced cheddar',         starred: false },
  { categoryId: 'cheese', name: 'mozzarella',             starred: false },
  { categoryId: 'cheese', name: 'shredded mozzarella',    starred: false },
  { categoryId: 'cheese', name: 'fresh mozzarella',       starred: false },
  { categoryId: 'cheese', name: 'parmesan',               starred: false },
  { categoryId: 'cheese', name: 'grated parmesan',        starred: false },
  { categoryId: 'cheese', name: 'cream cheese',           starred: false },
  { categoryId: 'cheese', name: 'feta',                   starred: false },
  { categoryId: 'cheese', name: 'sliced swiss',           starred: false },
  { categoryId: 'cheese', name: 'sliced provolone',       starred: false },
  { categoryId: 'cheese', name: 'shredded Mexican blend', starred: false },

  // yogurt
  { categoryId: 'yogurt', name: 'greek yogurt', starred: true  },
  { categoryId: 'yogurt', name: 'plain yogurt', starred: false },
  { categoryId: 'yogurt', name: 'yogurt cups',  starred: false },

  // butter & spreads
  { categoryId: 'butter-spreads', name: 'butter',    starred: true  },
  { categoryId: 'butter-spreads', name: 'margarine', starred: false },
  { categoryId: 'butter-spreads', name: 'hummus',    starred: false },

  // eggs
  { categoryId: 'eggs', name: 'eggs',       starred: true  },
  { categoryId: 'eggs', name: 'egg whites', starred: false },

  // deli prepared
  { categoryId: 'deli-prepared', name: 'fresh pasta', starred: false },
  { categoryId: 'deli-prepared', name: 'dips',        starred: false },
  { categoryId: 'deli-prepared', name: 'salsa',       starred: false },
  { categoryId: 'deli-prepared', name: 'pesto',       starred: false },

  // --- FROZEN ---
  // frozen meals
  { categoryId: 'frozen-meals', name: 'frozen pizza',    starred: true  },
  { categoryId: 'frozen-meals', name: 'frozen burrito',  starred: false },
  { categoryId: 'frozen-meals', name: 'frozen dumplings',starred: false },
  { categoryId: 'frozen-meals', name: 'lasagna',         starred: false },

  // frozen produce
  { categoryId: 'frozen-produce', name: 'frozen vegetables', starred: true  },
  { categoryId: 'frozen-produce', name: 'frozen berries',    starred: false },
  { categoryId: 'frozen-produce', name: 'frozen spinach',    starred: false },
  { categoryId: 'frozen-produce', name: 'frozen fruit',      starred: false },

  // frozen meat & seafood
  { categoryId: 'frozen-meat-seafood', name: 'frozen shrimp',       starred: false },
  { categoryId: 'frozen-meat-seafood', name: 'frozen chicken',      starred: false },
  { categoryId: 'frozen-meat-seafood', name: 'frozen fish fillet',  starred: false },

  // ice cream & desserts
  { categoryId: 'ice-cream-desserts', name: 'ice cream',    starred: true  },
  { categoryId: 'ice-cream-desserts', name: 'popsicle',     starred: false },
  { categoryId: 'ice-cream-desserts', name: 'frozen yogurt',starred: false },

  // frozen breakfast
  { categoryId: 'frozen-breakfast', name: 'frozen waffles',    starred: false },
  { categoryId: 'frozen-breakfast', name: 'hash browns',       starred: false },
  { categoryId: 'frozen-breakfast', name: 'breakfast sandwich',starred: false },

  // --- PACKAGED FOODS ---
  // beverages
  { categoryId: 'beverages', name: 'coffee',          starred: true  },
  { categoryId: 'beverages', name: 'sparkling water', starred: true  },
  { categoryId: 'beverages', name: 'tea',             starred: false },
  { categoryId: 'beverages', name: 'juice',           starred: false },
  { categoryId: 'beverages', name: 'soda',            starred: false },
  { categoryId: 'beverages', name: 'bottled water',   starred: false },
  { categoryId: 'beverages', name: 'kombucha',        starred: false },

  // snacks
  { categoryId: 'snacks', name: 'chips',       starred: true  },
  { categoryId: 'snacks', name: 'crackers',    starred: true  },
  { categoryId: 'snacks', name: 'popcorn',     starred: false },
  { categoryId: 'snacks', name: 'pretzels',    starred: false },
  { categoryId: 'snacks', name: 'trail mix',   starred: false },
  { categoryId: 'snacks', name: 'granola bar', starred: false },
  { categoryId: 'snacks', name: 'nuts',        starred: false },
  { categoryId: 'snacks', name: 'chocolate',   starred: false },
  { categoryId: 'snacks', name: 'cookies',     starred: false },

  // canned goods
  { categoryId: 'canned-goods', name: 'black beans',    starred: false },
  { categoryId: 'canned-goods', name: 'chickpeas',      starred: false },
  { categoryId: 'canned-goods', name: 'diced tomatoes', starred: false },
  { categoryId: 'canned-goods', name: 'tomato paste',   starred: false },
  { categoryId: 'canned-goods', name: 'tuna can',       starred: false },
  { categoryId: 'canned-goods', name: 'coconut milk',   starred: false },
  { categoryId: 'canned-goods', name: 'chicken broth',  starred: false },

  // condiments & sauces
  { categoryId: 'condiments-sauces', name: 'ketchup',        starred: true  },
  { categoryId: 'condiments-sauces', name: 'mayo',           starred: true  },
  { categoryId: 'condiments-sauces', name: 'mustard',        starred: true  },
  { categoryId: 'condiments-sauces', name: 'soy sauce',      starred: true  },
  { categoryId: 'condiments-sauces', name: 'sriracha',       starred: false },
  { categoryId: 'condiments-sauces', name: 'hot sauce',      starred: false },
  { categoryId: 'condiments-sauces', name: 'salad dressing', starred: false },
  { categoryId: 'condiments-sauces', name: 'BBQ sauce',      starred: false },
  { categoryId: 'condiments-sauces', name: 'relish',         starred: false },
  { categoryId: 'condiments-sauces', name: 'jam',            starred: false },

  // pasta & grains
  { categoryId: 'pasta-grains', name: 'pasta',    starred: true  },
  { categoryId: 'pasta-grains', name: 'rice',     starred: true  },
  { categoryId: 'pasta-grains', name: 'quinoa',   starred: false },
  { categoryId: 'pasta-grains', name: 'couscous', starred: false },
  { categoryId: 'pasta-grains', name: 'ramen',    starred: false },
  { categoryId: 'pasta-grains', name: 'noodles',  starred: false },

  // cereal & breakfast
  { categoryId: 'cereal-breakfast', name: 'cereal',       starred: true  },
  { categoryId: 'cereal-breakfast', name: 'oatmeal',      starred: false },
  { categoryId: 'cereal-breakfast', name: 'granola',      starred: false },
  { categoryId: 'cereal-breakfast', name: 'pancake mix',  starred: false },

  // soups & broths
  { categoryId: 'soups-broths', name: 'canned soup', starred: false },
  { categoryId: 'soups-broths', name: 'bone broth',  starred: false },
  { categoryId: 'soups-broths', name: 'ramen cups',  starred: false },

  // international
  { categoryId: 'international', name: 'curry paste',   starred: false },
  { categoryId: 'international', name: 'miso',          starred: false },
  { categoryId: 'international', name: 'rice vinegar',  starred: false },
  { categoryId: 'international', name: 'fish sauce',    starred: false },
  { categoryId: 'international', name: 'tahini',        starred: false },
  { categoryId: 'international', name: 'tortilla chips',starred: false },
  { categoryId: 'international', name: 'salsa',         starred: false },

  // --- BAKING, SPICES & OILS ---
  // baking
  { categoryId: 'baking', name: 'flour',           starred: true  },
  { categoryId: 'baking', name: 'sugar',           starred: true  },
  { categoryId: 'baking', name: 'brown sugar',     starred: false },
  { categoryId: 'baking', name: 'baking powder',   starred: false },
  { categoryId: 'baking', name: 'baking soda',     starred: false },
  { categoryId: 'baking', name: 'chocolate chips', starred: false },
  { categoryId: 'baking', name: 'vanilla extract', starred: false },

  // spices & seasonings
  { categoryId: 'spices-seasonings', name: 'salt',              starred: true  },
  { categoryId: 'spices-seasonings', name: 'black pepper',      starred: true  },
  { categoryId: 'spices-seasonings', name: 'garlic powder',     starred: false },
  { categoryId: 'spices-seasonings', name: 'onion powder',      starred: false },
  { categoryId: 'spices-seasonings', name: 'paprika',           starred: false },
  { categoryId: 'spices-seasonings', name: 'cumin',             starred: false },
  { categoryId: 'spices-seasonings', name: 'chili powder',      starred: false },
  { categoryId: 'spices-seasonings', name: 'cinnamon',          starred: false },
  { categoryId: 'spices-seasonings', name: 'oregano',           starred: false },
  { categoryId: 'spices-seasonings', name: 'Italian seasoning', starred: false },
  { categoryId: 'spices-seasonings', name: 'red pepper flakes', starred: false },

  // oils & vinegars
  { categoryId: 'oils-vinegars', name: 'olive oil',           starred: true  },
  { categoryId: 'oils-vinegars', name: 'vegetable oil',       starred: false },
  { categoryId: 'oils-vinegars', name: 'sesame oil',          starred: false },
  { categoryId: 'oils-vinegars', name: 'balsamic vinegar',    starred: false },
  { categoryId: 'oils-vinegars', name: 'apple cider vinegar', starred: false },
  { categoryId: 'oils-vinegars', name: 'cooking spray',       starred: false },

  // sweeteners
  { categoryId: 'sweeteners', name: 'honey',       starred: false },
  { categoryId: 'sweeteners', name: 'maple syrup', starred: false },
  { categoryId: 'sweeteners', name: 'agave',       starred: false },
  { categoryId: 'sweeteners', name: 'stevia',      starred: false },

  // --- PREPARED FOODS & BAKERY ---
  // bread & rolls
  { categoryId: 'bread-rolls', name: 'bread',         starred: true  },
  { categoryId: 'bread-rolls', name: 'bagel',         starred: false },
  { categoryId: 'bread-rolls', name: 'hamburger bun', starred: false },
  { categoryId: 'bread-rolls', name: 'hot dog bun',   starred: false },
  { categoryId: 'bread-rolls', name: 'dinner roll',   starred: false },
  { categoryId: 'bread-rolls', name: 'english muffin',starred: false },
  { categoryId: 'bread-rolls', name: 'sourdough',     starred: false },

  // tortillas & flatbreads
  { categoryId: 'tortillas-flatbreads', name: 'tortilla', starred: true  },
  { categoryId: 'tortillas-flatbreads', name: 'pita',     starred: false },
  { categoryId: 'tortillas-flatbreads', name: 'naan',     starred: false },

  // pastries & desserts
  { categoryId: 'pastries-desserts', name: 'muffin',    starred: false },
  { categoryId: 'pastries-desserts', name: 'croissant', starred: false },
  { categoryId: 'pastries-desserts', name: 'donut',     starred: false },
  { categoryId: 'pastries-desserts', name: 'cake',      starred: false },
  { categoryId: 'pastries-desserts', name: 'pie',       starred: false },

  // rotisserie & hot bar
  { categoryId: 'rotisserie-hotbar', name: 'rotisserie chicken', starred: false },
  { categoryId: 'rotisserie-hotbar', name: 'hot bar entree',     starred: false },
  { categoryId: 'rotisserie-hotbar', name: 'mac and cheese',     starred: false },

  // sushi & sandwiches
  { categoryId: 'sushi-sandwiches', name: 'california roll',     starred: false },
  { categoryId: 'sushi-sandwiches', name: 'pre-made sandwich',   starred: false },
  { categoryId: 'sushi-sandwiches', name: 'wrap',                starred: false },

  // --- PERSONAL CARE & PHARMACY ---
  // OTC meds
  { categoryId: 'otc-meds', name: 'ibuprofen',        starred: true  },
  { categoryId: 'otc-meds', name: 'acetaminophen',    starred: false },
  { categoryId: 'otc-meds', name: 'allergy medicine', starred: false },
  { categoryId: 'otc-meds', name: 'cold medicine',    starred: false },
  { categoryId: 'otc-meds', name: 'antacid',          starred: false },
  { categoryId: 'otc-meds', name: 'cough drops',      starred: false },

  // vitamins & supplements
  { categoryId: 'vitamins-supplements', name: 'multivitamin', starred: false },
  { categoryId: 'vitamins-supplements', name: 'vitamin D',    starred: false },
  { categoryId: 'vitamins-supplements', name: 'vitamin C',    starred: false },
  { categoryId: 'vitamins-supplements', name: 'probiotic',    starred: false },
  { categoryId: 'vitamins-supplements', name: 'fish oil',     starred: false },

  // first aid
  { categoryId: 'first-aid', name: 'band-aids',         starred: false },
  { categoryId: 'first-aid', name: 'neosporin',         starred: false },
  { categoryId: 'first-aid', name: 'hydrogen peroxide', starred: false },
  { categoryId: 'first-aid', name: 'rubbing alcohol',   starred: false },

  // oral care
  { categoryId: 'oral-care', name: 'toothpaste', starred: true  },
  { categoryId: 'oral-care', name: 'toothbrush', starred: false },
  { categoryId: 'oral-care', name: 'floss',      starred: false },
  { categoryId: 'oral-care', name: 'mouthwash',  starred: false },

  // hair & skin
  { categoryId: 'hair-skin', name: 'shampoo',     starred: true  },
  { categoryId: 'hair-skin', name: 'conditioner', starred: false },
  { categoryId: 'hair-skin', name: 'body wash',   starred: false },
  { categoryId: 'hair-skin', name: 'lotion',      starred: false },
  { categoryId: 'hair-skin', name: 'sunscreen',   starred: false },
  { categoryId: 'hair-skin', name: 'deodorant',   starred: false },
  { categoryId: 'hair-skin', name: 'face wash',   starred: false },

  // shaving & grooming
  { categoryId: 'shaving-grooming', name: 'razor',         starred: false },
  { categoryId: 'shaving-grooming', name: 'shaving cream', starred: false },

  // feminine care
  { categoryId: 'feminine-care', name: 'tampons',      starred: false },
  { categoryId: 'feminine-care', name: 'pads',         starred: false },
  { categoryId: 'feminine-care', name: 'panty liners', starred: false },

  // --- HOUSEHOLD & BULK ---
  // cleaning
  { categoryId: 'cleaning', name: 'dish soap',           starred: true  },
  { categoryId: 'cleaning', name: 'hand soap',           starred: true  },
  { categoryId: 'cleaning', name: 'all-purpose cleaner', starred: false },
  { categoryId: 'cleaning', name: 'glass cleaner',       starred: false },
  { categoryId: 'cleaning', name: 'bleach',              starred: false },
  { categoryId: 'cleaning', name: 'sponges',             starred: false },
  { categoryId: 'cleaning', name: 'disinfecting wipes',  starred: false },

  // paper goods
  { categoryId: 'paper-goods', name: 'paper towel',  starred: true  },
  { categoryId: 'paper-goods', name: 'toilet paper', starred: true  },
  { categoryId: 'paper-goods', name: 'tissues',      starred: false },
  { categoryId: 'paper-goods', name: 'napkins',      starred: false },

  // laundry
  { categoryId: 'laundry', name: 'laundry detergent', starred: true  },
  { categoryId: 'laundry', name: 'dryer sheets',      starred: false },
  { categoryId: 'laundry', name: 'fabric softener',   starred: false },
  { categoryId: 'laundry', name: 'stain remover',     starred: false },

  // kitchen consumables
  { categoryId: 'kitchen-consumables', name: 'trash bag',              starred: true  },
  { categoryId: 'kitchen-consumables', name: 'foil',                   starred: false },
  { categoryId: 'kitchen-consumables', name: 'plastic wrap',           starred: false },
  { categoryId: 'kitchen-consumables', name: 'parchment paper',        starred: false },
  { categoryId: 'kitchen-consumables', name: 'ziploc bag',             starred: false },
  { categoryId: 'kitchen-consumables', name: 'food storage container', starred: false },

  // pet
  { categoryId: 'pet', name: 'dog food',    starred: false },
  { categoryId: 'pet', name: 'cat food',    starred: false },
  { categoryId: 'pet', name: 'cat litter',  starred: false },
  { categoryId: 'pet', name: 'pet treats',  starred: false },

  // batteries & light bulbs
  { categoryId: 'batteries-bulbs', name: 'AA batteries',  starred: false },
  { categoryId: 'batteries-bulbs', name: 'AAA batteries', starred: false },
  { categoryId: 'batteries-bulbs', name: '9V battery',    starred: false },
  { categoryId: 'batteries-bulbs', name: 'light bulb',    starred: false },

  // storage & organization
  { categoryId: 'storage-organization', name: 'storage bin',         starred: false },
  { categoryId: 'storage-organization', name: 'ziploc bags (bulk)',  starred: false },

  // baby
  { categoryId: 'baby', name: 'diapers',   starred: false },
  { categoryId: 'baby', name: 'wipes',     starred: false },
  { categoryId: 'baby', name: 'formula',   starred: false },
  { categoryId: 'baby', name: 'baby food', starred: false },
];
