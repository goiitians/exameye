import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLabel, parseLabels, matchLabel, LABEL_VECTORS } from '../../src/core/labels.js';

test('normalizeLabel trims, collapses whitespace, lower-cases', () => {
  assert.equal(normalizeLabel('  Submit \n  Answers '), 'submit answers');
  assert.equal(normalizeLabel(''), '');
  assert.equal(normalizeLabel(undefined), '');
  assert.equal(normalizeLabel(null), '');
});

test('parseLabels splits on comma, normalises, drops empties', () => {
  assert.deepEqual(parseLabels('Finish, SUBMIT paper ,,'), ['finish', 'submit paper']);
  assert.deepEqual(parseLabels(''), []);
});

test('matchLabel is exact, not substring', () => {
  assert.equal(matchLabel('Submit', ['submit']), true);
  assert.equal(matchLabel('Submit now', ['submit']), false);
  assert.equal(matchLabel('', []), false);
});

test('LABEL_VECTORS pairs normalise as expected', () => {
  for (const [raw, expected] of LABEL_VECTORS) assert.equal(normalizeLabel(raw), expected);
});
