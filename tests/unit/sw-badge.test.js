import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.js';

const chrome = installFakeChrome();
const config = { startPrefix: 'https://e.x/start', examPrefix: '', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10, startButton: '', endButton: '', endMarker: '', maxMin: 0, tailMin: 0, desktopCapture: 'off', desktopRepromptMin: 5 };
await chrome.storage.local.set({ config });
const sw = await import('../../src/sw.js');
chrome.tabs.list = [
  { id: 1, windowId: 3, url: 'https://e.x/start', title: 'Exam', incognito: false, active: true },
  { id: 2, windowId: 3, url: 'https://g.x/', title: 'G', incognito: false },
];
chrome.windows.list = [{ id: 3, focused: true, state: 'normal' }];

test('badge: empty while IDLE, red 0 at arm, counts flagged events, cleared at session end', async () => {
  await sw.settled();
  assert.equal(chrome.action.badge.text, '');
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start', at: 1000 });
  assert.equal(chrome.action.badge.text, '0');
  assert.equal(chrome.action.badge.color, '#d03b3b');
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/q/1', at: 2000 });
  assert.equal(chrome.action.badge.text, '0');
  await sw.dispatch({ kind: 'TAB_ACTIVATED', tabId: 2, windowId: 3, url: 'https://g.x/', title: 'G', incognito: false, at: 4000 });
  assert.equal(chrome.action.badge.text, '2');
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/result', at: 9000 });
  assert.equal((await chrome.storage.local.get('session')).session.state, 'IDLE');
  assert.equal(chrome.action.badge.text, '');
});

test('badge is repainted from storage on a service worker start', async () => {
  const chrome2 = installFakeChrome();
  await chrome2.storage.local.set({
    config,
    session: { state: 'ARMED', id: 'S', seat: 'A17', startedAt: 1000, examTabId: 1, examWindowId: 3, examUrl: 'https://e.x/start', seq: 2, away: { tabAt: null, tabId: null, tabUrl: null, focusAt: null, minAt: null, idleAt: null, idleState: null }, tabLostAt: null, windowState: 'normal', maxAt: null },
    events: [{ seq: 1, t: 1000, name: 'SESSION_ARMED', data: {}, shot: null }, { seq: 2, t: 2000, name: 'COPY', data: { len: 3 }, shot: null }],
  });
  const sw2 = await import('../../src/sw.js?badge=2');
  await new Promise((r) => setTimeout(r, 20));
  await sw2.settled();
  assert.equal(chrome2.action.badge.text, '1');
});
