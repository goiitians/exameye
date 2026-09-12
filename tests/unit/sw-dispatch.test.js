import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.js';
import { verify } from '../../src/core/hashchain.js';

const chrome = installFakeChrome();
const config = { startPrefix: 'https://e.x/start', examPrefix: '', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10 };
const sw = await import('../../src/sw.js');
const get = (k) => chrome.storage.local.get(k);

test('invalid config: applyConfig records errors and dispatch is a no-op', async () => {
  await chrome.storage.local.set({ config: { ...config, seat: '' } });
  await sw.applyConfig();
  assert.equal((await get('meta')).meta.configErrors[0].field, 'seat');
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start', at: 1000 });
  assert.equal((await get('session')).session, undefined);
});

test('valid config registers the content script and the periodic alarm', async () => {
  await chrome.storage.local.set({ config });
  await sw.applyConfig();
  assert.deepEqual((await get('meta')).meta.configErrors, []);
  assert.deepEqual(chrome.scripting.registered[0].matches, ['https://e.x/start*', 'https://e.x/*']);
  assert.deepEqual(chrome.alarms.alarms.periodic, { periodInMinutes: 10 });
});

test('dispatch arms, writes header + chained lines, events carry hashes', async () => {
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start?c=1', at: 1000 });
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/q/1', at: 2000 });
  const { session, events, lines, lastHash, meta } = await get(null);
  assert.equal(session.state, 'ARMED');
  assert.equal(events.length, 2);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^# ExamEye session /);
  assert.equal((await verify(lines)).ok, true);
  assert.equal(events[1].hash, lastHash);
  assert.equal(meta.lastSeenAt, 2000);
});

test('a gap longer than 90 s is recorded before the next input', async () => {
  await sw.dispatch({ kind: 'PERIODIC', at: 102000 });
  const { events } = await get('events');
  assert.deepEqual(events.slice(-2).map(e => e.name), ['EXTENSION_GAP', 'PERIODIC']);
  assert.equal(events.at(-2).data.gapMs, 100000);
  assert.equal(events.at(-2).data.reason, 'sw-restart');
});

test('abandon effects create and clear the alarm', async () => {
  await sw.dispatch({ kind: 'TAB_REMOVED', tabId: 1, at: 200000 });
  assert.deepEqual(chrome.alarms.alarms.abandon, { when: 800000 });
  await sw.dispatch({ kind: 'NAV', tabId: 2, windowId: 3, url: 'https://e.x/q/2', at: 200500 });
  assert.equal(chrome.alarms.alarms.abandon, undefined);
});

test('probe dispatches FOCUS and WINDOW_STATE for the exam window', async () => {
  chrome.windows.list = [{ id: 3, focused: false, state: 'minimized' }];
  await sw.probe();
  const { events } = await get('events');
  assert.deepEqual(events.slice(-2).map(e => e.name), ['FOCUS_LEFT_CHROME', 'WINDOW_MINIMIZED']);
});

test('concurrent applyConfig and dispatch leave both meta fields intact', async () => {
  const before = await get('meta');
  const at = before.meta.lastSeenAt + 1000;
  await Promise.all([
    sw.applyConfig(),
    sw.dispatch({ kind: 'NAV', tabId: 2, windowId: 3, url: 'https://e.x/q/2', at }),
  ]);
  const { meta } = await get('meta');
  assert.deepEqual(meta.configErrors, []);
  assert.equal(meta.lastSeenAt, at);
});
