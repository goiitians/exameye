import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.js';

const chrome = installFakeChrome();
const config = { startPrefix: 'https://e.x/start', examPrefix: '', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10, startButton: '', endButton: '', endMarker: '', maxMin: 0, tailMin: 0, desktopCapture: 'off', desktopRepromptSec: 300 };
await chrome.storage.local.set({ config });
const sw = await import('../../src/sw.js');
chrome.tabs.list = [{ id: 1, windowId: 3, url: 'https://e.x/start', title: 'Exam', incognito: false, active: true }];
chrome.windows.list = [{ id: 3, focused: true, state: 'normal' }];
const get = (k) => chrome.storage.local.get(k);
const events = async () => (await get('events')).events;

test('a config change while ARMED is logged with the changed keys and a screenshot', async () => {
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start', at: 100000 });
  await chrome.storage.local.set({ config: { ...config, tailMin: 2, desktopRepromptSec: 0 } });
  await sw.settled();
  const ev = (await events()).at(-1);
  assert.equal(ev.name, 'CONFIG_CHANGED');
  assert.deepEqual(ev.data.keys, ['tailMin', 'desktopRepromptSec']);
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

test('one dispatch writes pending, session, events, lines, lastHash and meta in a single storage call', async () => {
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start', at: 300000 });
  const realSet = chrome.storage.local.set.bind(chrome.storage.local);
  const calls = [];
  chrome.storage.local.set = async (obj) => { calls.push(Object.keys(obj).sort()); return realSet(obj); };
  try {
    await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/q/8', at: 301000 });
  } finally { chrome.storage.local.set = realSet; }
  const want = ['events', 'lastHash', 'lines', 'meta', 'pending', 'session'];
  assert.ok(calls.some(k => want.every(w => k.includes(w))), JSON.stringify(calls));
  assert.equal((await get('meta')).meta.lastSeenAt, 301000);
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/result', at: 302000 });
});

test('after a clock rollback shots are captured afresh and a colliding name is disambiguated', async () => {
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start', at: 400000 });
  await sw.dispatch({ kind: 'PERIODIC', at: 460000 });
  const first = (await events()).at(-1);
  assert.match(first.shot, /_PERIODIC\.jpg$/);
  await sw.dispatch({ kind: 'PERIODIC', at: 400000 });
  let evs = await events();
  assert.deepEqual(evs.slice(-2).map(e => e.name), ['CLOCK_BACKWARDS', 'PERIODIC']);
  assert.notEqual(evs.at(-1).shot, first.shot, 'a rolled-back event must not reuse the pre-rollback screenshot');
  assert.match(evs.at(-1).shot, /_PERIODIC\.jpg$/);
  await sw.dispatch({ kind: 'PERIODIC', at: 460000 });
  evs = await events();
  assert.equal(evs.at(-1).shot, first.shot.replace(/\.jpg$/, '-2.jpg'));
  const { shots } = await get('shots');
  assert.ok(shots[first.shot] && shots[evs.at(-1).shot], 'both JPEGs must survive');
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/result', at: 461000 });
});

test('a screenshot dispatch writes shots and meta.lastShot in the same storage call as the event', async () => {
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start', at: 500000 });
  const realSet = chrome.storage.local.set.bind(chrome.storage.local);
  const calls = [];
  chrome.storage.local.set = async (obj) => { calls.push(obj); return realSet(obj); };
  try { await sw.dispatch({ kind: 'PERIODIC', at: 510000 }); } finally { chrome.storage.local.set = realSet; }
  const ev = (await events()).at(-1);
  const batch = calls.find(o => o.events && o.shots && o.meta);
  assert.ok(batch, JSON.stringify(calls.map(o => Object.keys(o))));
  assert.ok(batch.shots[ev.shot]);
  assert.equal(batch.meta.lastShot.file, ev.shot);
  assert.equal(calls.findIndex(o => o.shots), calls.indexOf(batch), 'shots must not be written before the batch');
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/result', at: 511000 });
});
