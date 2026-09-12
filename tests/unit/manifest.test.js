import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('manifest is MV3 with the agreed permissions', async () => {
  const m = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
  assert.equal(m.manifest_version, 3);
  assert.deepEqual(m.permissions, ['tabs', 'webNavigation', 'alarms', 'storage', 'unlimitedStorage', 'downloads', 'downloads.ui', 'idle', 'scripting']);
  assert.deepEqual(m.host_permissions, ['<all_urls>']);
  assert.equal(m.background.service_worker, 'src/sw.js');
  assert.equal(m.background.type, 'module');
  assert.equal(m.incognito, 'spanning');
  assert.equal(m.minimum_chrome_version, '120');
});
