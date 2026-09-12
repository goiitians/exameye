import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.js';

const chrome = installFakeChrome();
const config = { startPrefix: 'https://e.x/start', examPrefix: '', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10 };
await chrome.storage.local.set({ config });
const sw = await import('../../src/sw.js');
chrome.windows.list = [{ id: 3, focused: true, state: 'normal' }];
const get = (k) => chrome.storage.local.get(k);
const decode = (url) => Buffer.from(url.split(',')[1], 'base64').toString('utf8');

test('boot suppresses the download UI and erases own completed downloads', async () => {
  await chrome.runtime.onInstalled.emit();
  assert.deepEqual(chrome.downloads.uiOptions, { enabled: false });
  chrome.downloads.items = [{ id: 1, byExtensionId: 'fake-ext-id' }];
  await chrome.downloads.onChanged.emit({ id: 1, state: { current: 'complete' } });
  assert.deepEqual(chrome.downloads.erased, [1]);
});

test('every event flushes log.txt and new screenshots under <subfolder>/<sessionId>/', async () => {
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start', at: 1000 });
  const { session, pending, meta } = await get(null);
  const names = chrome.downloads.calls.map(c => c.filename);
  assert.deepEqual(names, [`ExamEye/${session.id}/log.txt`, `ExamEye/${session.id}/screenshots/${session.id.slice(0, 15)}_SESSION_ARMED.jpg`]);
  assert.match(decode(chrome.downloads.calls[0].url), /^# ExamEye session .*\n.* SESSION_ARMED .*\n$/);
  assert.equal(chrome.downloads.calls[1].url, 'data:image/jpeg;base64,/9j/FAKE');
  assert.deepEqual(pending, {});
  assert.equal(typeof meta.lastFlushAt, 'number');
  assert.equal(meta.lastFlushError, null);
});

test('a failed write stays pending and is replayed on the next flush', async () => {
  chrome.downloads.failWhen = (o) => o.filename.endsWith('log.txt');
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/q/1', at: 2000 });
  let { pending, meta } = await get(null);
  assert.deepEqual(Object.keys(pending).map(p => p.split('/').pop()), ['log.txt']);
  assert.match(meta.lastFlushError, /log\.txt/);
  chrome.downloads.failWhen = null;
  const n = chrome.downloads.calls.length;
  await sw.flush();
  ({ pending, meta } = await get(null));
  assert.deepEqual(pending, {});
  assert.equal(meta.lastFlushError, null);
  assert.equal(chrome.downloads.calls.length, n + 1);
  assert.match(decode(chrome.downloads.calls.at(-1).url), /EXAM_NAV/);
});
