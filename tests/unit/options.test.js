import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULTS } from '../../src/core/config.js';

test('options form has one field per config key and a module script', async () => {
  const html = await readFile(new URL('../../src/options/options.html', import.meta.url), 'utf8');
  for (const k of Object.keys(DEFAULTS)) assert.match(html, new RegExp(`name="${k}"`), k);
  assert.match(html, /<script type="module" src="options.js"><\/script>/);
});
