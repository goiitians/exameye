import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.js';

const chrome = installFakeChrome();
chrome.desktopCapture = {};
const config = { startPrefix: 'https://e.x/start', examPrefix: '', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10, startButton: '', endButton: '', endMarker: '', maxMin: 0, tailMin: 0, desktopCapture: 'on', desktopRepromptMin: 5 };
await chrome.storage.local.set({ config });
const sw = await import('../../src/sw.js');

const realCreate = chrome.windows.create.bind(chrome.windows);
chrome.windows.create = async (opts) => {
  const win = await realCreate(opts);
  chrome.tabs.list.push({ id: 9, windowId: win.id, url: opts.url, title: 'ExamEye capture', incognito: false, active: true });
  return win;
};
chrome.tabs.list = [{ id: 1, windowId: 3, url: 'https://e.x/start', title: 'Exam', incognito: false, active: true }];
const examWin = { id: 3, focused: true, state: 'normal' };
chrome.windows.list = [examWin];
chrome.tabs.responder = (m) => m.name === 'grab' ? { b64: 'DESKTOP', alive: true } : undefined;
let captureCalls = 0;
chrome.tabs.captureVisibleTab = async () => { captureCalls++; return 'data:image/jpeg;base64,/9j/FAKE'; };

const get = (k) => chrome.storage.local.get(k);
const names = async () => (await get('events')).events.map(e => e.name);
const desktop = async () => (await get('meta')).meta.desktop;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const unfocusAll = () => { for (const w of chrome.windows.list) w.focused = false; };
async function settle() { for (let i = 0; i < 4; i++) await sw.settled(); }

await chrome.webNavigation.onCommitted.emit({ tabId: 1, frameId: 0, url: 'https://e.x/start' });
await settle();
assert.equal((await get('session')).session.state, 'ARMED');
assert.equal((await desktop()).state, 'prompting');

test('the share picker does not suppress focus tracking: a focus loss while prompting is logged', async () => {
  unfocusAll();
  chrome.windows.onFocusChanged.emit(-1);
  await wait(700);
  await settle();
  assert.equal((await names()).at(-1), 'FOCUS_LEFT_CHROME');
  examWin.focused = true;
  chrome.windows.onFocusChanged.emit(3);
  await settle();
  assert.equal((await names()).at(-1), 'FOCUS_RETURNED');
});

test('focus leaving Chrome while the ExamEye popup is open is not FOCUS_LEFT_CHROME; closing the popup re-probes', async () => {
  const holderId = (await desktop()).holderWindowId;
  await chrome.runtime.onMessage.emit({ type: 'desktop', name: 'started', width: 1280, height: 720, pickMs: 100 }, { tab: { id: 9, windowId: holderId } }, () => {});
  await settle();
  assert.equal((await desktop()).state, 'on');
  examWin.focused = true;
  chrome.windows.onFocusChanged.emit(3);
  await settle();
  const port = chrome.runtime.connect({ name: 'popup' });
  unfocusAll();
  chrome.windows.onFocusChanged.emit(-1);
  await wait(700);
  await settle();
  assert.ok(!(await names()).slice(-2).includes('FOCUS_LEFT_CHROME'), 'the toolbar popup is ExamEye\'s own UI');
  // the popup closes but focus does not come back to a Chrome window: that is the candidate leaving
  port.disconnect();
  await wait(700);
  await settle();
  assert.equal((await names()).at(-1), 'FOCUS_LEFT_CHROME');
  examWin.focused = true;
  chrome.windows.onFocusChanged.emit(3);
  await settle();
  assert.equal((await names()).at(-1), 'FOCUS_RETURNED');
});

test('closing the popup with a Chrome window focused logs nothing', async () => {
  const port = chrome.runtime.connect({ name: 'popup' });
  await settle();
  const n = (await names()).length;
  port.disconnect();
  await wait(700);
  await settle();
  assert.equal((await names()).length, n);
});

test('with no ExamEye UI open, focus leaving Chrome is logged', async () => {
  assert.equal((await desktop()).state, 'on');
  unfocusAll();
  chrome.windows.onFocusChanged.emit(-1);
  await wait(700);
  await settle();
  assert.equal((await names()).at(-1), 'FOCUS_LEFT_CHROME');
});
