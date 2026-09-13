import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.js';

const chrome = installFakeChrome();
const config = { startPrefix: 'https://e.x/start', examPrefix: '', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10 };
await chrome.storage.local.set({ config });
const sw = await import('../../src/sw.js');
chrome.tabs.list = [
  { id: 1, windowId: 3, url: 'https://e.x/start', title: 'Exam', incognito: false, active: true },
  { id: 2, windowId: 3, url: '', pendingUrl: 'https://g.x/', title: '', incognito: false },
];
chrome.windows.list = [{ id: 3, focused: true, state: 'normal' }];
const get = (k) => chrome.storage.local.get(k);

test('a dispatch with no shot-worthy event never loads the shots map', async () => {
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start', at: 1000 });
  const realGet = chrome.storage.local.get.bind(chrome.storage.local);
  const shotReads = [];
  chrome.storage.local.get = async (keys) => { if ([].concat(keys).includes('shots')) shotReads.push(keys); return realGet(keys); };
  try {
    await sw.dispatch({ kind: 'TICK', at: 2000, windows: [{ id: 3, state: 'normal' }], examTabPresent: true });
    await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/q/1', at: 3000 });
  } finally { chrome.storage.local.get = realGet; }
  assert.deepEqual(shotReads, []);
});

test('onActivated on a tab that has not committed yet reports its pendingUrl', async () => {
  await chrome.tabs.onActivated.emit({ tabId: 2, windowId: 3 });
  await sw.settled();
  const ev = (await get('events')).events.at(-1);
  assert.equal(ev.name, 'PARALLEL_PAGE');
  assert.equal(ev.data.url, 'https://g.x/');
});

test('a session armed within 2 s of the previous RESULT shot gets its own SESSION_ARMED screenshot', async () => {
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/result', at: 10000 });
  assert.equal((await get('session')).session.state, 'IDLE');
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start', at: 10500 });
  const { events, shots } = await get(['events', 'shots']);
  assert.equal(events[0].name, 'SESSION_ARMED');
  assert.match(events[0].shot, /_SESSION_ARMED\.jpg$/);
  assert.ok(shots[events[0].shot], 'the shot must exist in the new session\'s shots map');
});
