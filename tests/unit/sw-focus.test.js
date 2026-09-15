import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.js';

const chrome = installFakeChrome();
const config = { startPrefix: 'https://e.x/start', examPrefix: '', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10, startButton: '', endButton: '', endMarker: '', maxMin: 0, tailMin: 0, desktopCapture: 'off', desktopRepromptMin: 5 };
await chrome.storage.local.set({ config });
const sw = await import('../../src/sw.js');
chrome.tabs.list = [{ id: 1, windowId: 3, url: 'https://e.x/start', title: 'Exam', incognito: false, active: true }];
const win = { id: 3, focused: true, state: 'normal' };
chrome.windows.list = [win];
const get = (k) => chrome.storage.local.get(k);
const names = async () => (await get('events')).events.map(e => e.name);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start', at: Date.now() });

test('a dialog blip (focus lost and regained within the settle window) is not a FOCUS_LEFT_CHROME', async () => {
  win.focused = false;
  chrome.windows.onFocusChanged.emit(-1);
  await wait(150);
  win.focused = true;
  chrome.windows.onFocusChanged.emit(3);
  await wait(700);
  await sw.settled();
  assert.ok(!(await names()).includes('FOCUS_LEFT_CHROME'), 'a 150 ms blip must not be logged');
  assert.ok(!(await names()).includes('FOCUS_RETURNED'));
});

test('the same blip through the content-script blur probe is also ignored', async () => {
  win.focused = false;
  chrome.runtime.onMessage.emit({ type: 'cs', name: 'BLUR', data: {} }, { tab: { id: 1, windowId: 3 }, url: 'https://e.x/start' });
  await wait(150);
  win.focused = true;
  await wait(700);
  await sw.settled();
  assert.ok(!(await names()).includes('FOCUS_LEFT_CHROME'));
});

test('a focus loss that persists past the settle window is logged, and the return closes it', async () => {
  win.focused = false;
  chrome.windows.onFocusChanged.emit(-1);
  await wait(700);
  await sw.settled();
  assert.equal((await names()).at(-1), 'FOCUS_LEFT_CHROME');
  win.focused = true;
  chrome.windows.onFocusChanged.emit(3);
  await sw.settled();
  const ev = (await get('events')).events.at(-1);
  assert.equal(ev.name, 'FOCUS_RETURNED');
  assert.ok(ev.data.awayMs >= 500);
});
