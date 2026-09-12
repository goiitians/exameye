import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.js';

const chrome = installFakeChrome();
const config = { startPrefix: 'https://e.x/start', examPrefix: '', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10 };
await chrome.storage.local.set({ config });
const sw = await import('../../src/sw.js');
chrome.windows.list = [{ id: 3, focused: true, state: 'normal' }];
const get = (k) => chrome.storage.local.get(k);
const decode = (url) => Buffer.from(url.split(',')[1], 'base64').toString('utf8');
const byName = (n) => chrome.downloads.calls.filter(c => c.filename.endsWith(n));

test('result navigation writes all files, then clears the session', async () => {
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start', at: 1000 });
  const { session: armed } = await get('session');
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/result', at: 61000 });
  const base = `ExamEye/${armed.id}/`;
  for (const f of ['log.txt', 'events.jsonl', 'summary.txt', 'summary.html']) assert.ok(byName(f).some(c => c.filename === base + f), f);
  const jsonl = decode(byName('events.jsonl').at(-1).url).trimEnd().split('\n').map(l => JSON.parse(l));
  assert.deepEqual(jsonl.map(e => e.name), ['SESSION_ARMED', 'SESSION_DISARMED']);
  assert.equal(typeof jsonl[1].hash, 'string');
  assert.match(decode(byName('summary.txt').at(-1).url), /Outcome: RESULT[\s\S]*Log chain: OK \(3 lines\)/);
  assert.ok(decode(byName('summary.html').at(-1).url).includes('data:image/jpeg;base64,/9j/FAKE'));
  const { session, events, lines, shots, pending } = await get(null);
  assert.deepEqual(session, { state: 'IDLE' });
  assert.deepEqual([events, lines, shots, pending], [[], [], {}, {}]);
});

test('recover() finishes an interrupted session end left as meta.pendingEnd', async () => {
  await sw.dispatch({ kind: 'NAV', tabId: 9, windowId: 3, url: 'https://e.x/start', at: 200000 });
  const { session: armed, events, lines, shots } = await get(['session', 'events', 'lines', 'shots']);
  // simulate a SW death right after the session flipped to IDLE but before endSession wrote
  // any of the final files: session/meta look exactly as dispatch() would have left them.
  await chrome.storage.local.set({ session: { state: 'IDLE' } });
  const { meta } = await get('meta');
  await chrome.storage.local.set({ meta: { ...meta, pendingEnd: { outcome: 'RESULT', session: armed } } });
  await chrome.storage.local.set({ events, lines, shots });
  await sw.recover();
  await sw.settled();
  const base = `ExamEye/${armed.id}/`;
  for (const f of ['log.txt', 'events.jsonl', 'summary.txt', 'summary.html']) assert.ok(byName(f).some(c => c.filename === base + f), f);
  assert.match(decode(byName('summary.txt').at(-1).url), /Outcome: RESULT/);
  const after = await get(['meta', 'session']);
  assert.equal(after.meta.pendingEnd, null);
  assert.deepEqual(after.session, { state: 'IDLE' });
});

test('ABANDON_TIMER produces summary files with outcome ABANDONED and clears pendingEnd', async () => {
  await sw.dispatch({ kind: 'NAV', tabId: 10, windowId: 3, url: 'https://e.x/start', at: 300000 });
  const { session: armed } = await get('session');
  await sw.dispatch({ kind: 'TAB_REMOVED', tabId: 10, at: 300100 });
  await sw.dispatch({ kind: 'ABANDON_TIMER', at: 300100 + 600000 });
  const base = `ExamEye/${armed.id}/`;
  for (const f of ['log.txt', 'events.jsonl', 'summary.txt', 'summary.html']) assert.ok(byName(f).some(c => c.filename === base + f), f);
  assert.match(decode(byName('summary.txt').at(-1).url), /Outcome: ABANDONED/);
  const { meta, session } = await get(['meta', 'session']);
  assert.equal(meta.pendingEnd, null);
  assert.deepEqual(session, { state: 'IDLE' });
});

test('if the inline summary.html is rejected, the linked variant is written instead', async () => {
  let n = 0;
  chrome.downloads.failWhen = (o) => o.filename.endsWith('summary.html') && n++ === 0;
  await sw.dispatch({ kind: 'NAV', tabId: 5, windowId: 3, url: 'https://e.x/start', at: 100000 });
  await sw.dispatch({ kind: 'NAV', tabId: 5, windowId: 3, url: 'https://e.x/result', at: 100500 });
  chrome.downloads.failWhen = null;
  const htmls = byName('summary.html').slice(-2).map(c => decode(c.url));
  assert.ok(htmls[1].includes('<img src="screenshots/'));
  assert.ok(!htmls[1].includes('data:image/jpeg'));
  assert.deepEqual((await get('pending')).pending, {});
});
