import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.js';
import { EMPTY_DESKTOP } from '../../src/core/desktop.js';

const chrome = installFakeChrome();
chrome.desktopCapture = {};
const config = { startPrefix: 'https://e.x/start', examPrefix: '', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10, startButton: '', endButton: '', endMarker: '', maxMin: 0, tailMin: 0, desktopCapture: 'off', desktopRepromptMin: 5 };
await chrome.storage.local.set({ config });
const sw = await import('../../src/sw.js');

const realCreate = chrome.windows.create.bind(chrome.windows);
chrome.windows.create = async (opts) => {
  const win = await realCreate(opts);
  chrome.tabs.list = chrome.tabs.list.filter(t => t.id !== 9);
  chrome.tabs.list.push({ id: 9, windowId: win.id, url: opts.url, title: 'ExamEye capture', incognito: false, active: true });
  return win;
};

const get = (k) => chrome.storage.local.get(k);
const armedSession = {
  state: 'ARMED', id: '20260101-000000_A17', seat: 'A17', subfolder: 'ExamEye', startedAt: 0, examTabId: 1, examWindowId: 3,
  examUrl: 'https://e.x/start', seq: 1, lastActivityAt: 0, tabLostAt: null, windowState: 'normal',
  away: { tabAt: null, tabId: null, tabUrl: null, focusAt: null, minAt: null, idleAt: null, idleState: null },
  maxAt: null, endClickAt: null, markerSeen: false, outcome: null, trigger: null, triggerLabel: null,
  examEndedAt: null, closingUntil: null, multiMonitorSeen: false,
};
// ids persisted by a previous browser session now name the exam window and tab
const exam = () => {
  chrome.tabs.list = [{ id: 1, windowId: 3, url: 'https://e.x/start', title: 'Exam', incognito: false, active: true }];
  chrome.windows.list = [{ id: 3, focused: false, state: 'minimized' }];
};

test('closeHolderNow leaves a window alone when it no longer hosts the holder page', async () => {
  exam();
  await chrome.storage.local.set({ session: armedSession, meta: { desktop: { ...EMPTY_DESKTOP, state: 'on', holderWindowId: 3, holderTabId: 1 } } });
  await chrome.storage.local.set({ config: { ...config, desktopCapture: 'off' } });
  await sw.settled();
  assert.ok(chrome.windows.list.some(w => w.id === 3), 'the exam window must not be closed');
  const { meta } = await get('meta');
  assert.equal(meta.desktop.state, 'off');
});

test('a holder message from the holder tab id but a different window is ignored (no minimise of a foreign window)', async () => {
  exam();
  chrome.windows.list = [{ id: 3, focused: true, state: 'normal' }, { id: 50, focused: false, state: 'normal' }];
  chrome.tabs.list.push({ id: 9, windowId: 50, url: chrome.runtime.getURL('src/holder/holder.html'), title: 'ExamEye capture', incognito: false, active: true });
  await chrome.storage.local.set({ session: armedSession, meta: { desktop: { ...EMPTY_DESKTOP, state: 'prompting', at: 0, asks: 1, holderWindowId: 3, holderTabId: 9 } } });
  let resp;
  await chrome.runtime.onMessage.emit({ type: 'desktop', name: 'ready' }, { tab: { id: 9, windowId: 50 } }, (r) => { resp = r; });
  await sw.settled();
  assert.deepEqual(resp, { close: true });
  await chrome.runtime.onMessage.emit({ type: 'desktop', name: 'started', width: 1, height: 1, pickMs: 1 }, { tab: { id: 9, windowId: 50 } }, () => {});
  await sw.settled();
  assert.equal(chrome.windows.list.find(w => w.id === 3).state, 'normal', 'the exam window must not be minimised');
  assert.equal((await get('meta')).meta.desktop.state, 'prompting');
});

test('askNow opens a fresh holder instead of showing a foreign window with stale ids', async () => {
  exam();
  await chrome.storage.local.set({ session: armedSession, meta: { desktop: { ...EMPTY_DESKTOP, state: 'declined', at: 0, nextAskAt: 0, asks: 1, holderWindowId: 3, holderTabId: 1 } } });
  chrome.tabs.sent = [];
  await chrome.storage.local.set({ config: { ...config, desktopCapture: 'on' } });
  await sw.settled();
  assert.equal(chrome.windows.list.find(w => w.id === 3).state, 'minimized', 'the exam window must not be shown');
  assert.ok(!chrome.tabs.sent.some(s => s.tabId === 1), 'no holder message to the exam tab');
  const { meta } = await get('meta');
  assert.equal(meta.desktop.state, 'prompting');
  assert.notEqual(meta.desktop.holderWindowId, 3);
  assert.equal(meta.desktop.holderTabId, 9);
  assert.equal(chrome.windows.list.filter(w => w.type === 'popup').length, 1);
});

test('askNow with a live holder window but no holder tab id opens a fresh holder rather than prompting nobody', async () => {
  const { meta: m0 } = await get('meta');
  await chrome.storage.local.set({ meta: { ...m0, desktop: { ...m0.desktop, state: 'declined', at: 0, nextAskAt: 0, holderTabId: null } } });
  const before = chrome.windows.list.filter(w => w.type === 'popup').length;
  await chrome.alarms.onAlarm.emit({ name: 'desktopAsk' });
  await sw.settled();
  const { meta } = await get('meta');
  assert.equal(meta.desktop.state, 'prompting');
  assert.equal(meta.desktop.holderTabId, 9);
  assert.equal(chrome.windows.list.filter(w => w.type === 'popup').length, before + 1);
  await chrome.storage.local.set({ config, session: { state: 'IDLE' } });
  await sw.settled();
});
