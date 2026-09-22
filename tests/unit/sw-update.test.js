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

const withDisk = (version) => { globalThis.fetch = async (url) => { if (!String(url).endsWith('/manifest.json')) throw new Error('unexpected ' + url); if (version === null) throw new Error('ENOENT'); return { json: async () => ({ version }) }; }; };
const state = async () => (await chrome.storage.local.get('session')).session?.state ?? 'IDLE';

test('tick does not reload when the on-disk version matches the running one', async () => {
  await sw.dispatch({ kind: 'TAB_REMOVED', tabId: 1, windowId: 3, at: Date.now() });
  assert.equal(await state(), 'IDLE');
  withDisk('0.1.0');
  await sw.tick();
  await sw.settled();
  assert.equal(chrome.runtime.reloads, 0);
});

test('tick reloads when the on-disk version differs and the session is IDLE with nothing pending', async () => {
  withDisk('0.1.9');
  await sw.tick();
  await sw.settled();
  assert.equal(chrome.runtime.reloads, 1);
});

test('no reload while ARMED or CLOSING; the transition to IDLE reloads without waiting for a tick', async () => {
  withDisk('0.1.9');
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start', at: Date.now() });
  assert.equal(await state(), 'ARMED');
  await sw.tick();
  await sw.settled();
  assert.equal(chrome.runtime.reloads, 1, 'ARMED');
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/result', at: Date.now() });
  assert.equal(await state(), 'CLOSING');
  await sw.tick();
  await sw.settled();
  assert.equal(chrome.runtime.reloads, 1, 'CLOSING');
  await sw.dispatch({ kind: 'TAB_REMOVED', tabId: 1, windowId: 3, at: Date.now() });
  await sw.settled();
  assert.equal(await state(), 'IDLE');
  assert.equal(chrome.runtime.reloads, 2, 'IDLE transition');
});

test('no reload while files are still pending', async () => {
  withDisk('0.1.9');
  await chrome.storage.local.set({ pending: { 'ExamEye/x/log.txt': { mime: 'text/plain', b64: 'aGk=' } } });
  chrome.downloads.failWhen = (o) => o.filename.endsWith('/log.txt');
  try { await sw.tick(); await sw.settled(); } finally { chrome.downloads.failWhen = null; }
  assert.equal(chrome.runtime.reloads, 2);
  await sw.flush();
  assert.deepEqual((await chrome.storage.local.get('pending')).pending, {});
});

// tick() replays meta.pendingEnd before the reload check, so the only way it is still set at
// check time is a replay that could not run: an invalid config makes loadConfig() return null,
// so tick()'s replay is skipped. Hide the config for that one tick.
test('no reload while a session end is unfinished', async () => {
  withDisk('0.1.9');
  const { meta, config } = await chrome.storage.local.get(['meta', 'config']);
  await chrome.storage.local.set({ meta: { ...meta, pendingEnd: { outcome: 'closed', session: { id: 'zz', state: 'IDLE', subfolder: 'ExamEye', seat: 'A17' }, events: [], lines: [], shots: {} } }, config: {} });
  await sw.settled();
  await sw.tick();
  await sw.settled();
  assert.equal(chrome.runtime.reloads, 2);
  await chrome.storage.local.set({ meta: { ...(await chrome.storage.local.get('meta')).meta, pendingEnd: null }, config });
  await sw.settled();
});

test('a failing manifest read (file mid-rename) is ignored until the next tick', async () => {
  withDisk(null);
  await sw.tick();
  await sw.settled();
  assert.equal(chrome.runtime.reloads, 2);
  withDisk('0.1.9');
  await sw.tick();
  await sw.settled();
  assert.equal(chrome.runtime.reloads, 3);
});
