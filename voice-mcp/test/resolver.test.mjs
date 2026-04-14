import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyCategoryDecisions,
  createListItems,
  resolveCandidateItems
} from '../src/resolution.js';

const context = {
  currentList: [
    { id: 1, name: 'bananas', category: 'FRUIT', quantity: '1', done: false }
  ],
  commonItems: {
    FRUIT: [{ id: 'f1', name: 'apples' }, { id: 'f2', name: 'bananas' }],
    'MEAT & FISH': [{ id: 'm1', name: 'ground pork' }]
  },
  lessCommonItems: {
    'DELI, DAIRY, EGGS': [{ id: 'd1', name: 'milk, 2%' }]
  }
};

test('resolveCandidateItems skips items already on the list', () => {
  const result = resolveCandidateItems(['bananas'], context);
  assert.equal(result.resolved.length, 0);
  assert.deepEqual(result.skipped, [{ spoken: 'bananas', reason: 'already_on_list' }]);
});

test('resolveCandidateItems exact-matches known suggestions', () => {
  const result = resolveCandidateItems(['apples'], context);
  assert.equal(result.unresolved.length, 0);
  assert.equal(result.resolved[0].name, 'apples');
  assert.equal(result.resolved[0].category, 'FRUIT');
  assert.equal(result.resolved[0].matchType, 'exact_existing');
});

test('resolveCandidateItems handles token reorder conservatively', () => {
  const result = resolveCandidateItems(['pork ground'], context);
  assert.equal(result.resolved[0].name, 'ground pork');
  assert.equal(result.resolved[0].category, 'MEAT & FISH');
  assert.equal(result.resolved[0].matchType, 'token_reorder_existing');
});

test('resolveCandidateItems leaves novel items unresolved', () => {
  const result = resolveCandidateItems(['masa harina'], context);
  assert.equal(result.resolved.length, 0);
  assert.deepEqual(result.unresolved, [{ spoken: 'masa harina', reason: 'no_confident_match' }]);
});

test('applyCategoryDecisions only promotes high-confidence novel items', () => {
  const highConfidence = applyCategoryDecisions(
    [{ spoken: 'masa harina', reason: 'no_confident_match' }],
    [{ spoken: 'masa harina', category: 'DRY GOODS', confidence: 0.84 }]
  );

  assert.equal(highConfidence.resolved[0].category, 'DRY GOODS');
  assert.equal(highConfidence.unresolved.length, 0);

  const lowConfidence = applyCategoryDecisions(
    [{ spoken: 'vitamins', reason: 'no_confident_match' }],
    [{ spoken: 'vitamins', category: 'PHARMACY / OTC', confidence: 0.61 }]
  );

  assert.equal(lowConfidence.resolved.length, 0);
  assert.equal(lowConfidence.unresolved[0].reason, 'low_category_confidence');
});

test('createListItems creates items using the existing list shape', () => {
  const items = createListItems(
    [{ spoken: 'apples', name: 'apples', category: 'FRUIT' }],
    context.currentList
  );

  assert.equal(items[0].name, 'apples');
  assert.equal(items[0].category, 'FRUIT');
  assert.equal(items[0].quantity, '1');
  assert.equal(items[0].done, false);
  assert.equal(typeof items[0].id, 'number');
});
