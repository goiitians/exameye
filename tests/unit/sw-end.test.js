import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.js';
import { verify } from '../../src/core/hashchain.js';

const chrome = installFakeChrome();
const config = { startPrefix: 'https://e.x/start', examPrefix: '', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10, startButton: '', endButton: '', endMarker: '', maxMin: 0, tailMin: 0, desktopCapture: 'off', desktopRepromptMin: 5 };
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
  assert.deepEqual(jsonl.map(e => e.name), ['SESSION_ARMED', 'RESULT_PAGE', 'SESSION_DISARMED']);
  assert.equal(typeof jsonl[2].hash, 'string');
  assert.match(decode(byName('summary.txt').at(-1).url), /Outcome: RESULT[\s\S]*Log chain: OK \(4 lines\)/);
  assert.ok(decode(byName('summary.html').at(-1).url).includes('data:image/jpeg;base64,/9j/FAKE'));
  const { session, events, lines, shots, pending } = await get(null);
  assert.deepEqual(session, { state: 'IDLE' });
  assert.deepEqual([events, lines, shots, pending], [[], [], {}, {}]);
});

test('a tick that fires while endSession is mid-flush does not re-run it over the cleared state', async () => {
  await sw.dispatch({ kind: 'NAV', tabId: 15, windowId: 3, url: 'https://e.x/start', at: 900000 });
  const { session: armed } = await get('session');
  const base = `ExamEye/${armed.id}/`;
  let releaseGate, started = false;
  const gate = new Promise((r) => { releaseGate = r; });
  const realDownload = chrome.downloads.download.bind(chrome.downloads);
  chrome.downloads.download = async (opts) => {
    if (opts.filename === `${base}log.txt`) { started = true; await gate; }
    return realDownload(opts);
  };
  // log.txt is legitimately rewritten whole on every flush, so it was already written once by
  // the arm dispatch above; only calls from this point on (the disarm, and whatever tick races
  // in) are relevant to "was endSession replayed redundantly".
  const before = chrome.downloads.calls.length;
  const disarmP = sw.dispatch({ kind: 'NAV', tabId: 15, windowId: 3, url: 'https://e.x/result', at: 900500 });
  for (let i = 0; i < 50 && !started; i++) await new Promise((r) => setTimeout(r, 0));
  assert.ok(started, 'the end-of-session flush never reached the gated log.txt download');
  const tickP = sw.tick();
  await new Promise((r) => setTimeout(r, 20));
  releaseGate();
  await Promise.all([disarmP, tickP]);
  await sw.settled();
  chrome.downloads.download = realDownload;
  const newCalls = chrome.downloads.calls.slice(before);
  const logCalls = newCalls.filter(c => c.filename === `${base}log.txt`);
  assert.equal(logCalls.length, 1, 'log.txt must be written exactly once for this disarm, not re-rendered by the racing tick');
  assert.match(decode(logCalls[0].url), /SESSION_ARMED/);
  const eventsCalls = newCalls.filter(c => c.filename === `${base}events.jsonl`);
  assert.equal(eventsCalls.length, 1, 'events.jsonl must be written exactly once');
  assert.notEqual(decode(eventsCalls[0].url).trim(), '', 'events.jsonl must not be re-rendered empty');
  assert.equal((await get('meta')).meta.pendingEnd, null);
});

test('recover() renders log.txt/events.jsonl from the pendingEnd snapshot, not from already-cleared live storage', async () => {
  await sw.dispatch({ kind: 'NAV', tabId: 14, windowId: 3, url: 'https://e.x/start', at: 800000 });
  const { session: armed } = await get('session');
  await sw.dispatch({ kind: 'NAV', tabId: 14, windowId: 3, url: 'https://e.x/result', at: 800500 });
  // this session has already ended normally; borrow its real (correct) rendered content as the
  // "snapshot" for a synthetic replay below, so the expected output is derived the same way
  // endSession itself derives it, not hand-typed.
  const jsonlEvents = decode(byName('events.jsonl').at(-1).url).trimEnd().split('\n').map(l => JSON.parse(l));
  const logLines = decode(byName('log.txt').at(-1).url).trimEnd().split('\n');
  const base = `ExamEye/${armed.id}/`;
  const expectedLog = logLines.join('\n') + '\n';
  const expectedEvents = jsonlEvents.map(ev => JSON.stringify(ev)).join('\n') + '\n';
  // simulate the state a crash right after a successful flush but before the final clear used to
  // leave under the pre-fix code: session IDLE, events/lines/shots already reset live, pending
  // holding something stale at the same paths, pendingEnd still set.
  await chrome.storage.local.set({
    session: { state: 'IDLE' }, events: [], lines: [], shots: {},
    pending: { [`${base}log.txt`]: { mime: 'text/plain', b64: Buffer.from('STALE\n').toString('base64') } },
  });
  const { meta } = await get('meta');
  await chrome.storage.local.set({ meta: { ...meta, pendingEnd: { outcome: 'RESULT', session: armed, events: jsonlEvents, lines: logLines, shots: {} } } });
  await sw.recover();
  await sw.settled();
  const finalLog = chrome.downloads.calls.filter(c => c.filename === `${base}log.txt`).at(-1);
  assert.equal(decode(finalLog.url), expectedLog, 'log.txt must be replayed from the snapshot, not left stale or emptied');
  const finalEvents = chrome.downloads.calls.filter(c => c.filename === `${base}events.jsonl`).at(-1);
  assert.equal(decode(finalEvents.url), expectedEvents, 'events.jsonl must be replayed from the snapshot, not emptied');
  assert.equal((await get('meta')).meta.pendingEnd, null);
});

test('recover() finishes an interrupted session end left as meta.pendingEnd', async () => {
  await sw.dispatch({ kind: 'NAV', tabId: 9, windowId: 3, url: 'https://e.x/start', at: 200000 });
  const { session: armed, events, lines, shots } = await get(['session', 'events', 'lines', 'shots']);
  // simulate a SW death right after the session flipped to IDLE but before endSession wrote
  // any of the final files: session/meta look exactly as dispatch() would have left them, with
  // pendingEnd carrying the full events/lines/shots snapshot as dispatch() now writes it.
  await chrome.storage.local.set({ session: { state: 'IDLE' } });
  const { meta } = await get('meta');
  await chrome.storage.local.set({ meta: { ...meta, pendingEnd: { outcome: 'RESULT', session: armed, events, lines, shots } } });
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

// Last test in the file: it leaves the module's session ARMED on purpose (a fresh session armed
// after the simulated crash), so nothing after it may assume IDLE.
test('replaying an old pendingEnd does not wipe a new session armed in the meantime', async () => {
  await sw.dispatch({ kind: 'NAV', tabId: 16, windowId: 3, url: 'https://e.x/start', at: 1000000 });
  const { session: oldArmed, events, lines, shots } = await get(['session', 'events', 'lines', 'shots']);
  await sw.dispatch({ kind: 'NAV', tabId: 16, windowId: 3, url: 'https://e.x/result', at: 1000500 });
  // the old session already ended normally (pendingEnd is null again); rewind pendingEnd to
  // simulate a crash between the atomic session/pendingEnd write and endSession's own final
  // pendingEnd clear -- the exact window this regression happens in. events/lines/shots are
  // already [] / [] / {} from the normal completed end above, matching what that atomic write
  // now leaves them as.
  const { meta } = await get('meta');
  await chrome.storage.local.set({ meta: { ...meta, pendingEnd: { outcome: 'RESULT', session: oldArmed, events, lines, shots } } });
  // the SW wakes on a NEW start-URL NAV before recover()/tick() gets a chance to replay the old
  // end -- arms a brand new session while the stale pendingEnd is still sitting in meta.
  chrome.tabs.list = [{ id: 17, windowId: 3, url: 'https://e.x/start', title: 'Exam', incognito: false }];
  await sw.dispatch({ kind: 'NAV', tabId: 17, windowId: 3, url: 'https://e.x/start', at: 1001000 });
  const { session: newArmed, lines: linesBeforeReplay } = await get(['session', 'lines']);
  assert.equal(newArmed.state, 'ARMED');
  assert.match(linesBeforeReplay[0], /^# ExamEye session/, 'the new session must have its header line before any replay');
  // the periodic tick alarm fires next; it must replay the old end from the snapshot without
  // touching the new session's live events/lines/shots.
  await sw.tick();
  await sw.settled();
  const oldBase = `ExamEye/${oldArmed.id}/`;
  for (const f of ['log.txt', 'events.jsonl', 'summary.txt', 'summary.html']) assert.ok(byName(f).some(c => c.filename === oldBase + f), `old session's ${f}`);
  assert.equal((await get('meta')).meta.pendingEnd, null);
  const { session: afterSession, lines: afterLines } = await get(['session', 'lines']);
  assert.equal(afterSession.id, newArmed.id, 'the new session must still be the live session');
  assert.equal(afterSession.state, 'ARMED');
  assert.match(afterLines[0], /^# ExamEye session/, 'the new session must keep its header line after the old end replays');
  assert.ok((await verify(afterLines)).ok, 'the new session log must still verify after the old pendingEnd replay');
});

test('closing alarm ends the session and the summary separates exam and tail phases', async () => {
  const { session: armed } = await get('session');
  assert.equal(armed.state, 'ARMED');
  await chrome.storage.local.set({ config: { ...config, endButton: 'Finish', tailMin: 5 } });
  chrome.tabs.list = [{ id: armed.examTabId, windowId: armed.examWindowId, url: 'https://e.x/start', title: 'Exam', incognito: false, active: true }];
  const realNow = Date.now;
  const realCapture = chrome.tabs.captureVisibleTab;
  let current = 'X';
  chrome.tabs.captureVisibleTab = async () => 'data:image/jpeg;base64,' + current;
  try {
    await sw.dispatch({ kind: 'CS', name: 'END_CLICK', tabId: armed.examTabId, windowId: armed.examWindowId, data: { label: 'finish' }, at: 1002000 });
    const { session: closing } = await get('session');
    assert.equal(closing.state, 'CLOSING');

    current = 'X1';
    Date.now = () => 1003000;
    await chrome.runtime.onMessage.emit({ type: 'cs', name: 'SCREEN_CHANGED', data: {} }, { tab: { id: armed.examTabId, windowId: armed.examWindowId }, url: 'https://e.x/q/1' });
    await sw.settled();

    current = 'X2';
    Date.now = () => 1007000;
    await chrome.runtime.onMessage.emit({ type: 'cs', name: 'SCREEN_CHANGED', data: {} }, { tab: { id: armed.examTabId, windowId: armed.examWindowId }, url: 'https://e.x/q/1' });
    await sw.settled();

    Date.now = () => 1007500;
    await chrome.alarms.onAlarm.emit({ name: 'closing' });
    await sw.settled();
  } finally { Date.now = realNow; chrome.tabs.captureVisibleTab = realCapture; }

  const { session: after, meta } = await get(['session', 'meta']);
  assert.deepEqual(after, { state: 'IDLE' });
  assert.equal(meta.pendingEnd, null);
  const summary = decode(byName('summary.txt').at(-1).url);
  assert.match(summary, /Outcome: SUBMITTED/);
  assert.match(summary, /Trigger:   end button "finish" clicked/);
  assert.match(summary, /Post-submit tail .* 2 screenshots/);
  const jsonl = decode(byName('events.jsonl').at(-1).url).trimEnd().split('\n').map(l => JSON.parse(l));
  const last = jsonl.at(-1);
  assert.equal(last.name, 'SESSION_DISARMED');
  assert.equal(last.data.phase, 'tail');
});
