import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_TAIL, decide } from '../../src/core/tailshots.js';

test('first capture is kept', () => {
  const r = decide(EMPTY_TAIL, { hash: 'a', at: 1000 });
  assert.equal(r.keep, true);
  assert.deepEqual(r.tail, { count: 1, lastHash: 'a', lastAt: 1000 });
});

test('same hash is dropped', () => {
  const after = decide(EMPTY_TAIL, { hash: 'a', at: 1000 }).tail;
  const r = decide(after, { hash: 'a', at: 10000 });
  assert.equal(r.keep, false);
  assert.deepEqual(r.tail, after);
});

test('different hash within 3 s is dropped', () => {
  const after = decide(EMPTY_TAIL, { hash: 'a', at: 1000 }).tail;
  const r = decide(after, { hash: 'b', at: 1000 + 2999 });
  assert.equal(r.keep, false);
  assert.deepEqual(r.tail, after);
});

test('61st capture is dropped', () => {
  let tail = EMPTY_TAIL;
  let at = 0;
  for (let i = 0; i < 60; i++) {
    at += 3000;
    const r = decide(tail, { hash: `h${i}`, at });
    assert.equal(r.keep, true, `capture ${i} should be kept`);
    tail = r.tail;
  }
  at += 3000;
  const r = decide(tail, { hash: 'h60', at });
  assert.equal(r.keep, false);
  assert.deepEqual(r.tail, tail);
});

test('a dropped capture does not change the tail state', () => {
  const tail = { count: 5, lastHash: 'x', lastAt: 5000 };
  const r = decide(tail, { hash: 'x', at: 6000 });
  assert.deepEqual(r.tail, tail);
});

test('decide(undefined, ...) treats undefined as EMPTY_TAIL', () => {
  const r = decide(undefined, { hash: 'a', at: 1000 });
  assert.equal(r.keep, true);
  assert.deepEqual(r.tail, { count: 1, lastHash: 'a', lastAt: 1000 });
});
