import { CATEGORIES, DEFAULT_CATEGORY_CONFIDENCE_THRESHOLD } from './constants.js';
import { buildShoppingContextSummary } from './contextSummary.js';
import { appendItemsToShoppingList, loadShoppingContext, saveShoppingHistory } from './firebaseRealtime.js';
import { normalizeItemName } from './normalize.js';
import { applyCategoryDecisions, createListItems, resolveCandidateItems } from './resolution.js';

export const getShoppingContext = async (env) => {
  const context = await loadShoppingContext(env);
  return {
    ...buildShoppingContextSummary(context)
  };
};

export const resolveItems = async (env, items) => {
  const context = await loadShoppingContext(env);
  const result = resolveCandidateItems(items, context);

  return {
    ...result,
    categoryContext: buildShoppingContextSummary(context)
  };
};

export const addResolvedItems = async (env, payload) => {
  const context = await loadShoppingContext(env);
  const deterministic = resolveCandidateItems(payload.items || [], context);

  let finalResolved = [...deterministic.resolved];
  let unresolved = deterministic.unresolved;

  if (payload.categoryDecisions?.length) {
    const withCategoryDecisions = applyCategoryDecisions(
      unresolved,
      payload.categoryDecisions,
      {
        minimumConfidence: payload.minimumCategoryConfidence ?? DEFAULT_CATEGORY_CONFIDENCE_THRESHOLD
      }
    );

    finalResolved = [...finalResolved, ...withCategoryDecisions.resolved];
    unresolved = withCategoryDecisions.unresolved;
  }

  const itemsToCreate = createListItems(finalResolved, context.currentList, payload.addedByUid);

  if (itemsToCreate.length > 0) {
    await appendItemsToShoppingList(env, itemsToCreate, payload.addedByUid);

    const history = new Set((context.history || []).map((item) => normalizeItemName(item)));
    for (const item of finalResolved) {
      history.add(normalizeItemName(item.name));
    }
    await saveShoppingHistory(env, [...history]);
  }

  return {
    added: finalResolved,
    skipped: deterministic.skipped,
    unresolved,
    summary: `Added ${finalResolved.length} item${finalResolved.length === 1 ? '' : 's'}${deterministic.skipped.length ? ` and skipped ${deterministic.skipped.length}` : ''}.`
  };
};
