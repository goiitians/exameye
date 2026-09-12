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

test('a dispatch landing mid-flush is not clobbered by the flush already in flight', async () => {
  const marker = 'ExamEye/_marker/marker.txt';
  await chrome.storage.local.set({ pending: { [marker]: { mime: 'text/plain', b64: Buffer.from('A').toString('base64') } } });
  let releaseGate, started = false;
  const gate = new Promise((r) => { releaseGate = r; });
  const realDownload = chrome.downloads.download.bind(chrome.downloads);
  chrome.downloads.download = async (opts) => {
    if (opts.filename === marker) { started = true; await gate; }
    return realDownload(opts);
  };
  const before = chrome.downloads.calls.length;
  const flushP = sw.flush();
  for (let i = 0; i < 50 && !started; i++) await new Promise((r) => setTimeout(r, 0));
  assert.ok(started, 'the flush never reached the gated download');
  const dispatchP = sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/q/2', at: 3000 });
  await new Promise((r) => setTimeout(r, 20));
  releaseGate();
  await Promise.all([flushP, dispatchP]);
  await sw.settled();
  chrome.downloads.download = realDownload;
  const { pending } = await get('pending');
  assert.deepEqual(pending, {});
  const newLogCalls = chrome.downloads.calls.slice(before).filter(c => c.filename.endsWith('log.txt'));
  assert.ok(newLogCalls.some(c => decode(c.url).includes('e.x/q/2')), 'the event added during the flush must have been downloaded, not silently dropped');
});
