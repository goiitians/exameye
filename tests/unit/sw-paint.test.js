import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.js';

const chrome = installFakeChrome();
const config = { startPrefix: 'https://e.x/start', examPrefix: '', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10, startButton: '', endButton: '', endMarker: '', maxMin: 0, tailMin: 0, desktopCapture: 'off', desktopRepromptMin: 5 };
await chrome.storage.local.set({ config });
const sw = await import('../../src/sw.js');
chrome.windows.list = [{ id: 3, focused: true, state: 'normal' }];
const tab = { id: 1, windowId: 3, url: 'https://e.x/start', title: 'Exam', incognito: false, active: true, status: 'loading' };
chrome.tabs.list = [tab];
const captured = [];
chrome.tabs.captureVisibleTab = async () => { captured.push(tab.status); return 'data:image/jpeg;base64,/9j/FAKE'; };
const get = (k) => chrome.storage.local.get(k);

test('SESSION_ARMED screenshot waits for the start page to finish loading', async () => {
  setTimeout(() => { tab.status = 'complete'; }, 150);
  const t0 = Date.now();
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start', at: Date.now() });
  assert.deepEqual(captured, ['complete']);
  assert.ok(Date.now() - t0 >= 150);
  assert.match((await get('events')).events[0].shot, /_SESSION_ARMED\.jpg$/);
});

test('a page that never reports complete is captured anyway after the bounded wait', async () => {
  tab.status = 'loading'; tab.url = 'https://e.x/result';
  const t0 = Date.now();
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/result', at: Date.now() + 5000 });
  assert.equal(captured.at(-1), 'loading');
  assert.ok(Date.now() - t0 < 2500, 'wait must be bounded');
  assert.ok(Date.now() - t0 >= 1000, 'must have actually waited for the page');
  assert.equal((await get('session')).session.state, 'IDLE');
});

test('events that are not navigation-born capture immediately', async () => {
  tab.status = 'complete'; tab.url = 'https://e.x/start';
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start', at: Date.now() + 10000 });
  await new Promise((r) => setTimeout(r, 1000)); // clear the 2-per-second capture quota window
  const n = captured.length;
  const t0 = Date.now();
  await sw.dispatch({ kind: 'PERIODIC', at: Date.now() + 20000 });
  assert.equal(captured.length, n + 1);
  assert.ok(Date.now() - t0 < 100);
});
