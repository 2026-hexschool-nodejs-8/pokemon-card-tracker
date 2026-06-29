import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractProductIds } from './tcgplayer.scraper.js';

test('flat object with productId', () => {
  assert.deepEqual(extractProductIds({ productId: 123, name: 'Charizard' }), [123]);
});

test('nested array of objects', () => {
  const input = { results: [{ productId: 100 }, { productId: 200 }] };
  assert.deepEqual(extractProductIds(input), [100, 200]);
});

test('ignores zero and negative numbers', () => {
  assert.deepEqual(extractProductIds({ productId: 0, id: -1 }), []);
});

test('ignores string values in id fields', () => {
  assert.deepEqual(extractProductIds({ productId: '123' }), []);
});

test('null input returns empty array', () => {
  assert.deepEqual(extractProductIds(null), []);
});
