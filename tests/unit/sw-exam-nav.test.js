import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.js';

const chrome = installFakeChrome();
chrome.desktopCapture = {};
const config = { startPrefix: 'https://e.x/start', examPrefix: 'https://e.x/paper/', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10, startButton: 'Start', endButton: '', endMarker: '', maxMin: 0, tailMin: 0, desktopCapture: 'on', desktopRepromptMin: 5 };
await chrome.storage.local.set({ config });
const sw = await import('../../src/sw.js');

const realCreate = chrome.windows.create.bind(chrome.windows);
chrome.windows.create = async (opts) => {
  const win = await realCreate(opts);
  chrome.tabs.list = chrome.tabs.list.filter(t => t.id !== 9);
  chrome.tabs.list.push({ id: 9, windowId: win.id, url: opts.url, title: 'ExamEye capture', incognito: false, active: true });
  return win;
};
chrome.tabs.list = [{ id: 1, windowId: 3, url: 'https://e.x/paper/q1', title: 'Exam', incognito: false, active: true }];
chrome.windows.list = [{ id: 3, focused: true, state: 'normal' }];
const settle = async () => { for (let i = 0; i < 4; i++) await sw.settled(); };
const get = (k) => chrome.storage.local.get(k);
const holderPopups = () => chrome.windows.list.filter(w => w.type === 'popup' && w.url === chrome.runtime.getURL('src/holder/holder.html'));

test('a paper-page NAV while IDLE arms with trigger exam-nav and asks for the screen share, even with a start button configured', async () => {
  await chrome.webNavigation.onCommitted.emit({ tabId: 1, frameId: 0, url: 'https://e.x/paper/q1' });
  await settle();
  const { session } = await get('session');
  assert.equal(session.state, 'ARMED');
  assert.equal(session.examTabId, 1);
  const { events } = await get('events');
  assert.deepEqual(events[0].data, { url: 'https://e.x/paper/q1', trigger: 'exam-nav' });
  assert.equal(holderPopups().length, 1);
  assert.equal((await get('meta')).meta.desktop.state, 'prompting');
});
