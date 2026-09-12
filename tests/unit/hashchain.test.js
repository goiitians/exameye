import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GENESIS, shortHash, prevHashOf, verify } from '../../src/core/hashchain.js';

test('shortHash is the first 8 hex chars of SHA-256', async () => {
  assert.equal(await shortHash('abc'), 'ba7816bf');
});

test('prevHashOf reads the trailing #hash', () => {
  assert.equal(prevHashOf('2026 X a=1 #ba7816bf'), 'ba7816bf');
});

test('verify accepts a valid chain and pinpoints a break', async () => {
  const l0 = `# header #${GENESIS}`;
  const l1 = `line one #${await shortHash(l0)}`;
  const l2 = `line two #${await shortHash(l1)}`;
  assert.deepEqual(await verify([l0, l1, l2]), { ok: true, firstBad: -1 });
  assert.deepEqual(await verify([l0, l1.replace('one', 'uno'), l2]), { ok: false, firstBad: 2 });
  assert.deepEqual(await verify([`# header #deadbeef`]), { ok: false, firstBad: 0 });
  assert.deepEqual(await verify([]), { ok: true, firstBad: -1 });
});
