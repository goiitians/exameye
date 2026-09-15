import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('manifest is MV3 with the agreed permissions', async () => {
  const m = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
  assert.equal(m.manifest_version, 3);
  assert.deepEqual(m.permissions, ['tabs', 'webNavigation', 'alarms', 'storage', 'unlimitedStorage', 'downloads', 'downloads.ui', 'idle', 'scripting', 'desktopCapture']);
  assert.deepEqual(m.host_permissions, ['<all_urls>']);
  assert.equal(m.background.service_worker, 'src/sw.js');
  assert.equal(m.background.type, 'module');
  assert.equal(m.incognito, 'spanning');
  assert.equal(m.minimum_chrome_version, '120');
});

test('manifest declares icons for every store-required size and each file exists as a PNG of that size', async () => {
  const m = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
  for (const size of ['16', '32', '48', '128']) {
    const path = m.icons?.[size];
    assert.ok(path, `icons.${size}`);
    const buf = await readFile(new URL(`../../${path}`, import.meta.url));
    assert.equal(buf.subarray(1, 4).toString(), 'PNG', path);
    assert.equal(buf.readUInt32BE(16), Number(size), `${path} width`);
    assert.equal(buf.readUInt32BE(20), Number(size), `${path} height`);
  }
  assert.deepEqual(m.action.default_icon, m.icons);
});
