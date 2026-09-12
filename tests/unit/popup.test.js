import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('popup has the live-state slots and a module script', async () => {
  const html = await readFile(new URL('../../src/popup/popup.html', import.meta.url), 'utf8');
  for (const id of ['state', 'session', 'flush', 'errors', 'counts']) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /<script type="module" src="popup.js"><\/script>/);
});
