import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.js';

const chrome = installFakeChrome();
const config = { startPrefix: 'https://e.x/start', examPrefix: '', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10 };
await chrome.storage.local.set({ config });
const sw = await import('../../src/sw.js');
chrome.tabs.list = [
  { id: 1, windowId: 3, url: 'https://e.x/start', title: 'Exam', incognito: false },
  { id: 2, windowId: 3, url: 'https://g.x/', title: 'G', incognito: false },
];
chrome.windows.list = [{ id: 3, focused: true, state: 'normal' }];
const get = (k) => chrome.storage.local.get(k);
const names = async () => (await get('events')).events.map(e => e.name);

test('onCommitted: subframes ignored, main frame arms and takes a screenshot', async () => {
  await chrome.webNavigation.onCommitted.emit({ tabId: 1, frameId: 7, url: 'https://e.x/start' });
  await sw.settled();
  assert.equal((await get('session')).session, undefined);
  await chrome.webNavigation.onCommitted.emit({ tabId: 1, frameId: 0, url: 'https://e.x/start?c=1' });
  await sw.settled();
  const { session, events, shots } = await get(null);
  assert.equal(session.state, 'ARMED');
  assert.match(events[0].shot, /^screenshots\/\d{8}-\d{6}_SESSION_ARMED\.jpg$/);
  assert.equal(shots[events[0].shot], '/9j/FAKE');
  assert.match((await get('lines')).lines[1], /shot="screenshots\//);
});

test('onActivated within 2 s reuses the previous screenshot file', async () => {
  await chrome.tabs.onActivated.emit({ tabId: 2, windowId: 3 });
  await sw.settled();
  const { events } = await get('events');
  assert.deepEqual(events.slice(-2).map(e => e.name), ['TAB_SWITCH', 'PARALLEL_PAGE']);
  assert.equal(events.at(-2).shot, events[0].shot);
  assert.equal(events.at(-2).data.toTitle, 'G');
});

test('onMessage: only the exam tab is heard', async () => {
  await chrome.runtime.onMessage.emit({ type: 'cs', name: 'COPY', data: { len: 3 } }, { tab: { id: 2, windowId: 3 } });
  await chrome.runtime.onMessage.emit({ type: 'cs', name: 'COPY', data: { len: 3 } }, { tab: { id: 1, windowId: 3 } });
  await sw.settled();
  assert.equal((await names()).filter(n => n === 'COPY').length, 1);
});

test('capture failure is recorded on the event, not thrown', async () => {
  chrome.tabs.captureVisibleTab = async () => { throw new Error('Cannot access contents'); };
  await sw.dispatch({ kind: 'PERIODIC', at: Date.now() + 5000 });
  const ev = (await get('events')).events.at(-1);
  assert.equal(ev.shot, null);
  assert.equal(ev.data.shotError, 'Cannot access contents');
  chrome.tabs.captureVisibleTab = async () => 'data:image/jpeg;base64,/9j/FAKE';
});

test('focus change, idle, downloads by others, windows', async () => {
  await chrome.windows.onFocusChanged.emit(-1);
  await chrome.idle.onStateChanged.emit('locked');
  await chrome.downloads.onCreated.emit({ id: 5, byExtensionId: 'fake-ext-id', url: 'x', filename: 'x', mime: 'x' });
  await chrome.downloads.onCreated.emit({ id: 6, url: 'https://f.x/a.pdf', filename: '/dl/a.pdf', mime: 'application/pdf' });
  await chrome.windows.onCreated.emit({ id: 8, incognito: true });
  await sw.settled();
  const n = await names();
  for (const x of ['FOCUS_LEFT_CHROME', 'IDLE_START', 'DOWNLOAD_STARTED', 'INCOGNITO_WINDOW_OPENED']) assert.ok(n.includes(x), x);
  assert.equal(n.filter(x => x === 'DOWNLOAD_STARTED').length, 1);
});

test('tick alarm reconciles state and updates lastSeenAt', async () => {
  chrome.windows.list = [{ id: 3, focused: false, state: 'minimized' }];
  const before = (await get('meta')).meta.lastSeenAt;
  await chrome.alarms.onAlarm.emit({ name: 'tick' });
  await sw.settled();
  assert.ok((await names()).includes('WINDOW_MINIMIZED'));
  assert.ok((await get('meta')).meta.lastSeenAt >= before);
});

test('recover on startup re-adopts the exam tab by URL', async () => {
  chrome.tabs.list = [{ id: 44, windowId: 9, url: 'https://e.x/q/7', title: 'Q7', incognito: false }];
  await chrome.runtime.onStartup.emit();
  await sw.settled();
  const { session } = await get('session');
  assert.equal(session.examTabId, 44);
  assert.equal(session.examWindowId, 9);
});
