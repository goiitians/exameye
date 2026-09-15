import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.js';
import { shortHash } from '../../src/core/hashchain.js';
import { EMPTY_TAIL } from '../../src/core/tailshots.js';

const chrome = installFakeChrome();
const config = { startPrefix: 'https://e.x/start', examPrefix: '', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10, startButton: '', endButton: '', endMarker: '', maxMin: 0, tailMin: 0, desktopCapture: 'off', desktopRepromptMin: 5 };
await chrome.storage.local.set({ config });
const sw = await import('../../src/sw.js');
chrome.tabs.list = [
  { id: 1, windowId: 3, url: 'https://e.x/start', title: 'Exam', incognito: false, active: true },
  { id: 2, windowId: 3, url: '', pendingUrl: 'https://g.x/', title: '', incognito: false },
];
chrome.windows.list = [{ id: 3, focused: true, state: 'normal' }];
const get = (k) => chrome.storage.local.get(k);
const names = async () => (await get('events')).events.map(e => e.name);

let current = 'A';
let captureCalls = 0;
chrome.tabs.captureVisibleTab = async () => { captureCalls++; return 'data:image/jpeg;base64,' + current; };
const sc = async () => {
  await chrome.runtime.onMessage.emit({ type: 'cs', name: 'SCREEN_CHANGED', data: {} }, { tab: { id: 1, windowId: 3 }, url: 'https://e.x/q/1' });
  await sw.settled();
};

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

test('SCREEN_CHANGED while ARMED records nothing and captures nothing', async () => {
  assert.equal((await get('session')).session.state, 'ARMED');
  const before = captureCalls;
  await sc();
  assert.equal(captureCalls, before);
  assert.ok(!(await names()).includes('SCREEN_CHANGED'));
});

test('first SCREEN_CHANGED in CLOSING is captured once, hashed, filed and logged', async () => {
  await chrome.storage.local.set({ config: { ...config, endButton: 'Finish', tailMin: 5 } });
  await sw.dispatch({ kind: 'CS', name: 'END_CLICK', tabId: 1, windowId: 3, data: { label: 'finish' }, at: 20000 });
  assert.equal((await get('session')).session.state, 'CLOSING');
  const before = captureCalls;
  current = 'B';
  const realNow = Date.now;
  Date.now = () => 21000;
  try { await sc(); } finally { Date.now = realNow; }
  assert.equal(captureCalls, before + 1);
  const { events, shots, meta } = await get(['events', 'shots', 'meta']);
  const ev = events.at(-1);
  assert.equal(ev.name, 'SCREEN_CHANGED');
  assert.equal(ev.data.hash, await shortHash('B'));
  assert.match(ev.shot, /_SCREEN_CHANGED\.jpg$/);
  assert.ok(shots[ev.shot]);
  assert.equal(meta.tail.count, 1);
});

test('same image again is dropped; different image within 3 s is dropped; different image after 3 s is kept', async () => {
  const realNow = Date.now;
  try {
    current = 'B';
    Date.now = () => 21100;
    await sc();
    assert.equal((await get('meta')).meta.tail.count, 1, 'same image must be dropped');

    current = 'C';
    Date.now = () => 23500;
    await sc();
    assert.equal((await get('meta')).meta.tail.count, 1, 'different image within 3 s must be dropped');

    current = 'D';
    Date.now = () => 24500;
    await sc();
    assert.equal((await get('meta')).meta.tail.count, 2, 'different image after 3 s must be kept');
  } finally { Date.now = realNow; }
});

test('SCREEN_CHANGED from a non-active exam tab is dropped', async () => {
  chrome.tabs.list[0].active = false;
  const before = captureCalls;
  const beforeCount = (await get('meta')).meta.tail.count;
  await sc();
  assert.equal(captureCalls, before);
  assert.equal((await get('meta')).meta.tail.count, beforeCount);
  chrome.tabs.list[0].active = true;
});

test('entering CLOSING resets meta.tail', async () => {
  await sw.dispatch({ kind: 'CLOSING_TIMER', at: 30000 });
  assert.equal((await get('session')).session.state, 'IDLE');
  await chrome.storage.local.set({ config: { ...config, endButton: 'Finish', tailMin: 5 } });
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start', at: 31000 });
  assert.equal((await get('session')).session.state, 'ARMED');
  const { meta } = await get('meta');
  await chrome.storage.local.set({ meta: { ...meta, tail: { count: 60, lastHash: 'x', lastAt: 1 } } });
  await sw.dispatch({ kind: 'CS', name: 'END_CLICK', tabId: 1, windowId: 3, data: { label: 'finish' }, at: 32000 });
  assert.equal((await get('session')).session.state, 'CLOSING');
  assert.deepEqual((await get('meta')).meta.tail, EMPTY_TAIL);
  await chrome.storage.local.set({ config });
});
