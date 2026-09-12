import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toBase64, dataUrl, putText, putBase64, remove } from '../../src/core/sink.js';

test('toBase64 encodes UTF-8 like Buffer does, including large bodies', () => {
  assert.equal(toBase64('héllo ✓'), Buffer.from('héllo ✓').toString('base64'));
  const big = 'x'.repeat(200000);
  assert.equal(toBase64(big), Buffer.from(big).toString('base64'));
});

test('dataUrl', () => {
  assert.equal(dataUrl('text/plain', 'aGk='), 'data:text/plain;base64,aGk=');
});

test('put/remove are immutable and later puts overwrite', () => {
  const p0 = {};
  const p1 = putText(p0, 'S/log.txt', 'text/plain', 'a');
  const p2 = putText(p1, 'S/log.txt', 'text/plain', 'ab');
  const p3 = putBase64(p2, 'S/screenshots/x.jpg', 'image/jpeg', '/9j/');
  assert.deepEqual(p0, {});
  assert.equal(p1['S/log.txt'].b64, 'YQ==');
  assert.equal(p2['S/log.txt'].b64, 'YWI=');
  assert.deepEqual(Object.keys(p3), ['S/log.txt', 'S/screenshots/x.jpg']);
  assert.deepEqual(Object.keys(remove(p3, 'S/log.txt')), ['S/screenshots/x.jpg']);
  assert.deepEqual(Object.keys(p3).length, 2);
});
