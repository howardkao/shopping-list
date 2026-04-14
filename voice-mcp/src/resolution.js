import { DEFAULT_FUZZY_THRESHOLD, MATCH_CONFIDENCE } from './constants.js';
import { levenshteinSimilarity } from './levenshtein.js';
import {
  normalizeForSingularComparison,
  normalizeItemName,
  toSortedTokenSignature
} from './normalize.js';

const flattenSuggestions = (context) => {
  const all = [];
  for (const [category, items] of Object.entries(context.commonItems || {})) {
    for (const item of items) {
      all.push({ name: item.name, category, source: 'common' });
    }
  }

  for (const [category, items] of Object.entries(context.lessCommonItems || {})) {
    for (const item of items) {
      all.push({ name: item.name, category, source: 'less-common' });
    }
  }

  return all;
};

const buildKnownItemIndex = (context) => {
  return flattenSuggestions(context).map((item) => ({
    ...item,
    normalizedName: normalizeItemName(item.name),
    singularName: normalizeForSingularComparison(item.name),
    tokenSignature: toSortedTokenSignature(item.name)
  }));
};

const isAlreadyOnList = (spoken, currentList) => {
  const normalizedSpoken = normalizeItemName(spoken);
  const singularSpoken = normalizeForSingularComparison(spoken);

  return currentList.some((item) => {
    const normalizedName = normalizeItemName(item.name);
    return normalizedName === normalizedSpoken || normalizeForSingularComparison(item.name) === singularSpoken;
  });
};

const exactMatch = (spoken, knownItems) => {
  const normalizedSpoken = normalizeItemName(spoken);
  const singularSpoken = normalizeForSingularComparison(spoken);
  const tokenSignature = toSortedTokenSignature(spoken);

  for (const item of knownItems) {
    if (item.normalizedName === normalizedSpoken) {
      return { ...item, matchType: 'exact_existing', confidence: MATCH_CONFIDENCE.EXACT };
    }
  }

  for (const item of knownItems) {
    if (item.singularName === singularSpoken) {
      return { ...item, matchType: 'singular_plural_existing', confidence: MATCH_CONFIDENCE.SINGULAR_PLURAL };
    }
  }

  for (const item of knownItems) {
    if (item.tokenSignature === tokenSignature) {
      return { ...item, matchType: 'token_reorder_existing', confidence: MATCH_CONFIDENCE.TOKEN_REORDER };
    }
  }

  return null;
};

const fuzzyMatch = (spoken, knownItems, threshold) => {
  const normalizedSpoken = normalizeItemName(spoken);

  let bestMatch = null;

  for (const item of knownItems) {
    if (Math.abs(item.normalizedName.length - normalizedSpoken.length) > 4) {
      continue;
    }

    const score = levenshteinSimilarity(normalizedSpoken, item.normalizedName);
    if (score < threshold) {
      continue;
    }

    if (!bestMatch || score > bestMatch.confidence) {
      bestMatch = {
        ...item,
        matchType: 'fuzzy_existing',
        confidence: Number(score.toFixed(4))
      };
    }
  }

  return bestMatch;
};

export const resolveCandidateItems = (items, context, options = {}) => {
  const fuzzyThreshold = options.fuzzyThreshold ?? DEFAULT_FUZZY_THRESHOLD;
  const currentList = context.currentList || [];
  const knownItems = buildKnownItemIndex(context);

  const resolved = [];
  const skipped = [];
  const unresolved = [];

  for (const spoken of items) {
    if (!spoken || !String(spoken).trim()) {
      continue;
    }

    if (isAlreadyOnList(spoken, currentList)) {
      skipped.push({ spoken, reason: 'already_on_list' });
      continue;
    }

    const matched = exactMatch(spoken, knownItems) || fuzzyMatch(spoken, knownItems, fuzzyThreshold);

    if (matched) {
      resolved.push({
        spoken,
        name: matched.name,
        category: matched.category,
        source: matched.source,
        matchType: matched.matchType,
        confidence: matched.confidence
      });
      continue;
    }

    unresolved.push({
      spoken,
      reason: 'no_confident_match'
    });
  }

  return { resolved, skipped, unresolved };
};

export const applyCategoryDecisions = (unresolved, decisions, options = {}) => {
  const minimumConfidence = options.minimumConfidence ?? 0.8;
  const resolved = [];
  const stillUnresolved = [];

  for (const item of unresolved) {
    const decision = decisions.find((candidate) => normalizeItemName(candidate.spoken) === normalizeItemName(item.spoken));

    if (!decision) {
      stillUnresolved.push(item);
      continue;
    }

    if ((decision.confidence ?? 0) < minimumConfidence) {
      stillUnresolved.push({
        ...item,
        reason: 'low_category_confidence',
        candidateCategories: decision.category ? [decision.category] : undefined
      });
      continue;
    }

    resolved.push({
      spoken: item.spoken,
      name: item.spoken,
      category: decision.category,
      source: 'claude-category',
      matchType: 'novel_item_category',
      confidence: decision.confidence
    });
  }

  return {
    resolved,
    unresolved: stillUnresolved
  };
};

export const createListItems = (items, existingList, addedByUid) => {
  const maxId = existingList.reduce((largest, item) => {
    return typeof item.id === 'number' && item.id > largest ? item.id : largest;
  }, Date.now());

  let nextId = maxId;
  const now = Date.now();

  return items.map((item) => {
    nextId += 1;
    return {
      id: nextId,
      name: item.name,
      category: item.category,
      quantity: '1',
      done: false,
      addedBy: addedByUid || null,
      addedAt: now
    };
  });
};
