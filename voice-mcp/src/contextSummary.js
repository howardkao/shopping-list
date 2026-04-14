import { CATEGORIES } from './constants.js';

export const buildShoppingContextSummary = (context, options = {}) => {
  const maxExamplesPerCategory = options.maxExamplesPerCategory ?? 6;
  const summary = {};

  for (const category of CATEGORIES) {
    const common = (context.commonItems?.[category] || []).map((item) => item.name);
    const lessCommon = (context.lessCommonItems?.[category] || []).map((item) => item.name);
    const combined = [...common, ...lessCommon].slice(0, maxExamplesPerCategory);

    summary[category] = {
      currentList: (context.currentList || [])
        .filter((item) => item.category === category)
        .map((item) => item.name),
      examples: combined
    };
  }

  return {
    categories: [...CATEGORIES],
    categorySummary: summary
  };
};
