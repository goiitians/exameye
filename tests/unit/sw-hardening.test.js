import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.js';

const chrome = installFakeChrome();
const config = { startPrefix: 'https://e.x/start', examPrefix: '', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10, startButton: '', endButton: '', endMarker: '', maxMin: 0, tailMin: 0, desktopCapture: 'off', desktopRepromptMin: 5 };
await chrome.storage.local.set({ config });
const sw = await import('../../src/sw.js');
chrome.tabs.list = [{ id: 1, windowId: 3, url: 'https://e.x/start', title: 'Exam', incognito: false, active: true }];
chrome.windows.list = [{ id: 3, focused: true, state: 'normal' }];
const get = (k) => chrome.storage.local.get(k);
const events = async () => (await get('events')).events;

test('a config change while ARMED is logged with the changed keys and a screenshot', async () => {
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start', at: 100000 });
  await chrome.storage.local.set({ config: { ...config, tailMin: 2, desktopRepromptMin: 0 } });
  await sw.settled();
  const ev = (await events()).at(-1);
  assert.equal(ev.name, 'CONFIG_CHANGED');
  assert.deepEqual(ev.data.keys, ['tailMin', 'desktopRepromptMin']);
  assert.match(ev.shot, /CONFIG_CHANGED\.jpg$/);
});

test('subfolder is frozen at arm: a mid-session change does not move the files', async () => {
  await chrome.storage.local.set({ config: { ...config, subfolder: 'Elsewhere' } });
  await sw.settled();
  const { session } = await get('session');
  assert.equal(session.state, 'ARMED');
  assert.equal(session.subfolder, 'ExamEye');
  assert.ok(chrome.downloads.calls.at(-1).filename.startsWith(`ExamEye/${session.id}/`), chrome.downloads.calls.at(-1).filename);
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/result', at: 105000 });
  const summary = chrome.downloads.calls.filter(c => c.filename.endsWith('summary.txt')).at(-1);
  assert.ok(summary.filename.startsWith(`ExamEye/${session.id}/`), summary.filename);
  assert.equal((await get('session')).session.state, 'IDLE');
  await chrome.storage.local.set({ config });
  await sw.settled();
});

test('an input timestamped more than 5 s before the last seen time logs CLOCK_BACKWARDS first', async () => {
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start', at: 200000 });
  await sw.dispatch({ kind: 'PERIODIC', at: 250000 });
  await sw.dispatch({ kind: 'PERIODIC', at: 210000 });
  let evs = await events();
  assert.deepEqual(evs.slice(-2).map(e => e.name), ['CLOCK_BACKWARDS', 'PERIODIC']);
  assert.deepEqual(evs.at(-2).data, { lastSeenAt: 250000, backMs: 40000 });
  await sw.dispatch({ kind: 'PERIODIC', at: 208000 });
  evs = await events();
  assert.deepEqual(evs.slice(-2).map(e => e.name), ['PERIODIC', 'PERIODIC']);
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/result', at: 209000 });
  assert.equal((await get('session')).session.state, 'IDLE');
});
