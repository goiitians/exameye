import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.js';

const chrome = installFakeChrome();
const config = { startPrefix: 'https://e.x/start', examPrefix: '', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10, startButton: '', endButton: '', endMarker: '', maxMin: 0, tailMin: 0, desktopCapture: 'off', desktopRepromptMin: 5 };
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

test('onActivated within 2 s of the arming shot takes its own screenshot of the new tab', async () => {
  chrome.tabs.list[1].active = true;
  chrome.tabs.captureVisibleTab = async (w) => 'data:image/jpeg;base64,TAB' + chrome.tabs.list.find(t => t.windowId === w && t.active).id;
  await chrome.tabs.onActivated.emit({ tabId: 2, windowId: 3 });
  await sw.settled();
  const { events, shots } = await get(['events', 'shots']);
  assert.deepEqual(events.slice(-2).map(e => e.name), ['TAB_SWITCH', 'PARALLEL_PAGE']);
  assert.notEqual(events.at(-2).shot, events[0].shot, 'the arming shot shows the exam tab, not the switched-to one');
  assert.equal(shots[events.at(-2).shot], 'TAB2');
  assert.equal(events.at(-1).shot, events.at(-2).shot);
  assert.equal(events.at(-2).data.toTitle, 'G');
  chrome.tabs.captureVisibleTab = async () => 'data:image/jpeg;base64,/9j/FAKE';
  chrome.tabs.list[1].active = false;
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
  chrome.windows.list[0].focused = false;
  chrome.windows.onFocusChanged.emit(-1);
  await new Promise((r) => setTimeout(r, 650));
  await chrome.idle.onStateChanged.emit('locked');
  await chrome.downloads.onCreated.emit({ id: 5, byExtensionId: 'fake-ext-id', url: 'x', filename: 'x', mime: 'x' });
  await chrome.downloads.onCreated.emit({ id: 6, url: 'https://f.x/a.pdf', filename: '/dl/a.pdf', mime: 'application/pdf' });
  await chrome.windows.onCreated.emit({ id: 8, incognito: true });
  await sw.settled();
  const n = await names();
  for (const x of ['FOCUS_LEFT_CHROME', 'IDLE_START', 'DOWNLOAD_STARTED', 'INCOGNITO_WINDOW_OPENED']) assert.ok(n.includes(x), x);
  assert.equal(n.filter(x => x === 'DOWNLOAD_STARTED').length, 1);
});

test('downloads.onCreated: own data: URL writes are ignored even without byExtensionId, other origins still fire', async () => {
  const before = (await names()).filter(x => x === 'DOWNLOAD_STARTED').length;
  await chrome.downloads.onCreated.emit({ id: 7, url: 'data:text/plain;base64,aGVsbG8=', filename: '', mime: 'text/plain' });
  await sw.settled();
  assert.equal((await names()).filter(x => x === 'DOWNLOAD_STARTED').length, before, 'data: URL own-write must not fire DOWNLOAD_STARTED');
  await chrome.downloads.onCreated.emit({ id: 8, url: 'https://other.x/report.pdf', filename: '/dl/report.pdf', mime: 'application/pdf' });
  await sw.settled();
  assert.equal((await names()).filter(x => x === 'DOWNLOAD_STARTED').length, before + 1, 'https: URL from another origin must still fire DOWNLOAD_STARTED');
  const beforeBlob = (await names()).filter(x => x === 'DOWNLOAD_STARTED').length;
  await chrome.downloads.onCreated.emit({ id: 9, url: 'blob:https://e.x/1234-5678', filename: 'download.png', mime: 'image/png' });
  await sw.settled();
  assert.equal((await names()).filter(x => x === 'DOWNLOAD_STARTED').length, beforeBlob + 1, 'blob: URL (e.g. a page-initiated canvas export) must still fire DOWNLOAD_STARTED');
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

test('window focus returning to the exam tab window closes the tab-away episode', async () => {
  chrome.tabs.list = [
    { id: 44, windowId: 9, url: 'https://e.x/q/7', title: 'Exam', incognito: false, active: true },
    { id: 45, windowId: 20, url: 'https://g.x/', title: 'G', incognito: false, active: true },
  ];
  await chrome.windows.onCreated.emit({ id: 20, incognito: false });
  await chrome.tabs.onActivated.emit({ tabId: 45, windowId: 20 });
  await sw.settled();
  assert.ok((await names()).includes('TAB_SWITCH'));
  assert.notEqual((await get('session')).session.away.tabAt, null);
  await chrome.windows.onFocusChanged.emit(9);
  await sw.settled();
  assert.ok((await names()).includes('TAB_RETURN'), 'expected TAB_RETURN from the synthetic TAB_ACTIVATED on focus return');
  assert.equal((await get('session')).session.away.tabAt, null);
});

test('onHistoryStateUpdated and onReferenceFragmentUpdated dispatch NAV like onCommitted', async () => {
  chrome.tabs.list = [{ id: 44, windowId: 9, url: 'https://e.x/q/7', title: 'Exam', incognito: false, active: true }];
  await chrome.webNavigation.onHistoryStateUpdated.emit({ tabId: 44, frameId: 0, url: 'https://e.x/q/2' });
  await sw.settled();
  assert.equal((await names()).at(-1), 'EXAM_NAV');
  assert.equal((await get('events')).events.at(-1).data.url, 'https://e.x/q/2');
  await chrome.webNavigation.onReferenceFragmentUpdated.emit({ tabId: 44, frameId: 0, url: 'https://e.x/q/3' });
  await sw.settled();
  assert.equal((await names()).at(-1), 'EXAM_NAV');
  assert.equal((await get('events')).events.at(-1).data.url, 'https://e.x/q/3');
  const before = (await names()).length;
  await chrome.webNavigation.onHistoryStateUpdated.emit({ tabId: 44, frameId: 7, url: 'https://e.x/q/4' });
  await sw.settled();
  assert.equal((await names()).length, before, 'frameId 7 must be ignored');
});

test('onMessage passes sender.url into the CS input', async () => {
  await chrome.webNavigation.onCommitted.emit({ tabId: 44, frameId: 0, url: 'https://e.x/result' });
  await sw.settled();
  assert.equal((await get('session')).session.state, 'IDLE');
  await chrome.storage.local.set({ config: { ...config, startButton: 'Start' } });
  await chrome.runtime.onMessage.emit({ type: 'cs', name: 'START_CLICK', data: { label: 'start' } }, { tab: { id: 1, windowId: 3 }, url: 'https://e.x/start' });
  await sw.settled();
  const { session } = await get('session');
  assert.equal(session.state, 'ARMED');
  assert.equal((await get('events')).events.at(-1).data.trigger, 'button');
  await chrome.storage.local.set({ config });
});

test('max and closing alarms dispatch MAX_TIMER and CLOSING_TIMER', async () => {
  await chrome.webNavigation.onCommitted.emit({ tabId: 1, frameId: 0, url: 'https://e.x/result' });
  await sw.settled();
  assert.equal((await get('session')).session.state, 'IDLE');
  await chrome.storage.local.set({ config: { ...config, maxMin: 1, tailMin: 1, endButton: 'Finish' } });
  chrome.tabs.list = [{ id: 50, windowId: 3, url: 'https://e.x/start', title: 'Exam', incognito: false, active: true }];
  await chrome.webNavigation.onCommitted.emit({ tabId: 50, frameId: 0, url: 'https://e.x/start' });
  await sw.settled();
  const { session: armed } = await get('session');
  assert.equal(armed.state, 'ARMED');
  assert.equal(chrome.alarms.alarms.max.when, armed.startedAt + 60000);
  await chrome.alarms.onAlarm.emit({ name: 'max' });
  await sw.settled();
  const { session: closing } = await get('session');
  assert.equal(closing.state, 'CLOSING');
  assert.equal(closing.outcome, 'TIMED_OUT');
  assert.equal(chrome.alarms.alarms.closing.when, closing.closingUntil);
  await chrome.alarms.onAlarm.emit({ name: 'closing' });
  await sw.settled();
  assert.equal((await get('session')).session.state, 'IDLE');
  const summary = chrome.downloads.calls.filter(c => c.filename.endsWith('summary.txt')).at(-1);
  assert.match(Buffer.from(summary.url.split(',')[1], 'base64').toString('utf8'), /Outcome: TIMED_OUT/);
  await chrome.storage.local.set({ config });
});
