import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.js';

const chrome = installFakeChrome();
const config = { startPrefix: 'https://e.x/start', examPrefix: '', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10, startButton: '', endButton: '', endMarker: '', maxMin: 0, tailMin: 5, desktopCapture: 'off', desktopRepromptMin: 5 };
await chrome.storage.local.set({ config });
const sw = await import('../../src/sw.js');
chrome.windows.list = [{ id: 3, focused: true, state: 'normal' }];
chrome.tabs.list = [{ id: 1, windowId: 3, url: 'https://e.x/start', title: 'Exam', incognito: false, active: true }];
const STATE = 'ExamEye-updater/state.txt';
const decode = (url) => Buffer.from(url.split(',')[1], 'base64').toString('utf8');
const markers = () => chrome.downloads.calls.filter(c => c.filename === STATE).map(c => decode(c.url));
const later = () => new Promise((r) => setTimeout(r, 30));

test('a plain worker start does not write the state marker', async () => {
  await later();
  await sw.settled();
  assert.deepEqual(markers(), []);
});

test('onInstalled writes the current state (IDLE with no session)', async () => {
  await chrome.runtime.onInstalled.emit({ reason: 'update' });
  await later();
  await sw.settled();
  assert.deepEqual(markers(), ['IDLE\n']);
});

test('the marker is written on every session transition, once, with the new state', async () => {
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start', at: 1000 });
  assert.deepEqual(markers(), ['IDLE\n', 'ARMED\n']);
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/q/1', at: 2000 });
  assert.deepEqual(markers(), ['IDLE\n', 'ARMED\n'], 'an event without a state change writes nothing');
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/result', at: 3000 });
  assert.deepEqual(markers(), ['IDLE\n', 'ARMED\n', 'CLOSING\n']);
  await sw.dispatch({ kind: 'TAB_REMOVED', tabId: 1, windowId: 3, at: 4000 });
  assert.deepEqual(markers(), ['IDLE\n', 'ARMED\n', 'CLOSING\n', 'IDLE\n']);
  const last = chrome.downloads.calls.filter(c => c.filename === STATE).at(-1);
  assert.equal(last.conflictAction, 'overwrite');
  assert.equal(last.saveAs, false);
  assert.match(last.url, /^data:text\/plain;base64,/);
});

// recover() on onStartup stamps meta.lastSeenAt with the wall clock, so every later input in this
// file uses Date.now() rather than a small fixed timestamp (a fixed one would read as clock skew).
test('onStartup rewrites the marker from the stored session (a crash while ARMED leaves a stale file)', async () => {
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start', at: 5000 });
  const n = markers().length;
  chrome.runtime.onStartup.emit();
  await later();
  await sw.settled();
  assert.deepEqual(markers().slice(n), ['ARMED\n']);
});

test('a refused marker write records meta.lastError and does not stop the session', async () => {
  chrome.downloads.failWhen = (o) => o.filename === STATE;
  try {
    await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/result', at: Date.now() });
  } finally { chrome.downloads.failWhen = null; }
  const { session, meta } = await chrome.storage.local.get(['session', 'meta']);
  assert.equal(session.state, 'CLOSING');
  assert.match(meta.lastError, /state marker/);
  assert.ok(chrome.downloads.calls.some(c => c.filename.endsWith('/log.txt') && decode(c.url).includes('SESSION_DISARMED')), 'the disarm was still flushed');
});
