import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLAGS, flagCount } from '../../src/core/flags.js';

test('FLAGS keeps the report order and flagCount sums only flagged names', () => {
  assert.equal(FLAGS[0][0], 'PARALLEL_PAGE');
  assert.ok(FLAGS.some(([n]) => n === 'SCREENSAVER'));
  assert.ok(FLAGS.every(([, , level]) => ['warning', 'serious', 'critical'].includes(level)));
  assert.equal(flagCount({}), 0);
  assert.equal(flagCount({ TAB_SWITCH: 2, PARALLEL_PAGE: 1, EXAM_NAV: 9, SESSION_ARMED: 1 }), 3);
});
