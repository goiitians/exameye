import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.js';
import { EMPTY_TAIL } from '../../src/core/tailshots.js';

const chrome = installFakeChrome();
chrome.desktopCapture = {};
const config = { startPrefix: 'https://e.x/start', examPrefix: '', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10, startButton: '', endButton: '', endMarker: '', maxMin: 0, tailMin: 0, desktopCapture: 'on', desktopRepromptMin: 5 };
await chrome.storage.local.set({ config });
const sw = await import('../../src/sw.js');

const realCreate = chrome.windows.create.bind(chrome.windows);
chrome.windows.create = async (opts) => {
  const win = await realCreate(opts);
  chrome.tabs.list = chrome.tabs.list.filter(t => t.id !== 9);
  chrome.tabs.list.push({ id: 9, windowId: win.id, url: opts.url, title: 'ExamEye capture', incognito: false, active: true });
  return win;
};

chrome.tabs.list = [{ id: 1, windowId: 3, url: 'https://e.x/start', title: 'Exam', incognito: false, active: true }];
chrome.windows.list = [{ id: 3, focused: true, state: 'normal' }];

let current = 'DESKTOP_A';
let alive = true;
chrome.runtime.responder = (m) => m.name === 'grab' ? { b64: alive ? current : null, alive } : undefined;

let captureCalls = 0;
const realCapture = chrome.tabs.captureVisibleTab.bind(chrome.tabs);
chrome.tabs.captureVisibleTab = async (...args) => { captureCalls++; return realCapture(...args); };

async function settle() { for (let i = 0; i < 4; i++) await sw.settled(); }
const get = (k) => chrome.storage.local.get(k);
const names = async () => (await get('events')).events.map(e => e.name);
const holderMsg = (m, wid) => chrome.runtime.onMessage.emit({ type: 'desktop', ...m }, { tab: { id: 9, windowId: wid } }, () => {});
const desktop = async () => (await get('meta')).meta.desktop;

async function armAndStart() {
  chrome.tabs.list = [{ id: 1, windowId: 3, url: 'https://e.x/start', title: 'Exam', incognito: false, active: true }];
  await chrome.webNavigation.onCommitted.emit({ tabId: 1, frameId: 0, url: 'https://e.x/start' });
  await settle();
  const holderId = (await desktop()).holderWindowId;
  await holderMsg({ name: 'started', width: 1920, height: 1080, pickMs: 100 }, holderId);
  await settle();
  return holderId;
}

test('PERIODIC while on files a desktop frame as data.desktopShot and enqueues it', async () => {
  await armAndStart();
  const { session: armed } = await get('session');
  const armedAt = (await get('meta')).meta.lastShot.at;
  const realNow = Date.now;
  Date.now = () => armedAt + 3000;
  try {
    await sw.dispatch({ kind: 'PERIODIC', at: Date.now() });
    await settle();
  } finally { Date.now = realNow; }
  const { events, shots } = await get(['events', 'shots']);
  const ev = events.at(-1);
  assert.equal(ev.name, 'PERIODIC');
  assert.match(ev.data.desktopShot, /^screenshots\/desktop\/\d{8}-\d{6}_PERIODIC\.jpg$/);
  assert.equal(shots[ev.data.desktopShot], current);
  assert.ok(chrome.downloads.calls.some(c => c.filename === `ExamEye/${armed.id}/${ev.data.desktopShot}`), 'desktop frame must be enqueued for download');
  assert.match(ev.shot, /^screenshots\/\d{8}-\d{6}_PERIODIC\.jpg$/);
});

test('FOCUS_LEFT_CHROME grabs, resets desktopAway and sends away on; FOCUS_RETURNED grabs and sends away off', async () => {
  await chrome.storage.local.set({ meta: { ...(await get('meta')).meta, desktopAway: { count: 5, lastHash: 'x', lastAt: 1 } } });
  chrome.runtime.sent = [];
  for (const w of chrome.windows.list) w.focused = false;
  chrome.windows.onFocusChanged.emit(-1);
  await new Promise((r) => setTimeout(r, 650));
  await settle();
  const leftEv = (await get('events')).events.find(e => e.name === 'FOCUS_LEFT_CHROME');
  assert.ok(leftEv.data.desktopShot);
  assert.ok(chrome.runtime.sent.some(m => m.type === 'holder' && m.name === 'away' && m.on === true));
  assert.deepEqual((await get('meta')).meta.desktopAway, EMPTY_TAIL);

  chrome.windows.list[0].focused = true;
  await chrome.windows.onFocusChanged.emit(3);
  await settle();
  const returnEv = (await get('events')).events.find(e => e.name === 'FOCUS_RETURNED');
  assert.ok(returnEv);
  assert.ok(returnEv.data.desktopShot);
  assert.ok(chrome.runtime.sent.some(m => m.type === 'holder' && m.name === 'away' && m.on === false));
});

test('holder frames: first kept as DESKTOP_FRAME{n:1} with shot the desktop file; same hash dropped; within 3 s dropped; the 41st dropped', async () => {
  const holderId = (await desktop()).holderWindowId;
  const beforeCaptureCalls = captureCalls;
  const realNow = Date.now;
  let t0 = 5000000;
  Date.now = () => t0;
  try {
    await holderMsg({ name: 'frame', b64: 'F1' }, holderId);
    await settle();
    let events = (await get('events')).events;
    const ev1 = events.at(-1);
    assert.equal(ev1.name, 'DESKTOP_FRAME');
    assert.equal(ev1.data.n, 1);
    assert.equal(ev1.data.desktopShot, undefined);
    assert.match(ev1.shot, /^screenshots\/desktop\//);
    const lenAfterFirst = events.length;
    const lastAt = t0;

    Date.now = () => lastAt + 500;
    await holderMsg({ name: 'frame', b64: 'F1' }, holderId);
    await settle();
    assert.equal((await names()).length, lenAfterFirst, 'same hash must be dropped');

    Date.now = () => lastAt + 1000;
    await holderMsg({ name: 'frame', b64: 'F2' }, holderId);
    await settle();
    assert.equal((await names()).length, lenAfterFirst, 'a different hash within 3 s must be dropped');

    Date.now = () => lastAt + 3500;
    await holderMsg({ name: 'frame', b64: 'F3' }, holderId);
    await settle();
    events = (await get('events')).events;
    assert.equal(events.length, lenAfterFirst + 1, 'a different hash after 3 s must be kept');
    assert.equal(events.at(-1).data.n, 2);

    let t = lastAt + 3500;
    for (let i = 4; i <= 41; i++) {
      t += 4000;
      Date.now = () => t;
      await holderMsg({ name: 'frame', b64: 'F' + i }, holderId);
      await settle();
    }
    assert.equal((await get('meta')).meta.desktopAway.count, 40);
    const beforeOverCap = (await names()).length;
    t += 4000;
    Date.now = () => t;
    await holderMsg({ name: 'frame', b64: 'F-over-cap' }, holderId);
    await settle();
    assert.equal((await names()).length, beforeOverCap, 'the frame past the 40-per-episode cap must be dropped');
  } finally { Date.now = realNow; }
  assert.equal(captureCalls, beforeCaptureCalls, 'needsShot tab capture must never run for holder frames');
});

test('grab without a frame records desktopShotError and keeps the event', async () => {
  const saved = chrome.runtime.responder;
  chrome.runtime.responder = (m) => m.name === 'grab' ? { b64: null, alive: true } : { alive: true };
  await sw.dispatch({ kind: 'PERIODIC', at: Date.now() });
  await settle();
  let ev = (await get('events')).events.at(-1);
  assert.equal(ev.name, 'PERIODIC');
  assert.equal(ev.data.desktopShotError, 'no frame');
  assert.equal(ev.data.desktopShot, undefined);

  chrome.runtime.responder = () => { throw new Error('boom'); };
  await sw.dispatch({ kind: 'PERIODIC', at: Date.now() });
  await settle();
  ev = (await get('events')).events.at(-1);
  assert.equal(ev.data.desktopShotError, 'stream not alive');
  chrome.runtime.responder = saved;
});

test('no desktop grab is attempted while state is not on', async () => {
  const meta = (await get('meta')).meta;
  await chrome.storage.local.set({ meta: { ...meta, desktop: { ...meta.desktop, state: 'declined' } } });
  chrome.runtime.sent = [];
  await sw.dispatch({ kind: 'PERIODIC', at: Date.now() });
  await settle();
  assert.ok(!chrome.runtime.sent.some(m => m.name === 'grab'));
  await chrome.storage.local.set({ meta: { ...meta, desktop: { ...meta.desktop, state: 'on' } } });
});

test('frames are ignored while desktop is not on or the session is IDLE', async () => {
  const holderId = (await desktop()).holderWindowId;
  const meta = (await get('meta')).meta;
  await chrome.storage.local.set({ meta: { ...meta, desktop: { ...meta.desktop, state: 'declined' } } });
  const before = (await names()).length;
  await holderMsg({ name: 'frame', b64: 'ignored-1' }, holderId);
  await settle();
  assert.equal((await names()).length, before, 'a frame while desktop is not on must be ignored');
  await chrome.storage.local.set({ meta: { ...meta, desktop: { ...meta.desktop, state: 'on' } } });

  await chrome.webNavigation.onCommitted.emit({ tabId: 1, frameId: 0, url: 'https://e.x/result' });
  await settle();
  assert.equal((await get('session')).session.state, 'IDLE');
  const before2 = (await names()).length;
  await holderMsg({ name: 'frame', b64: 'ignored-2' }, holderId);
  await settle();
  assert.equal((await names()).length, before2, 'a frame while the session is IDLE must be ignored');
});

test('tick grab not alive → STOPPED{reason:error} and a re-ask', async () => {
  await armAndStart();
  chrome.runtime.sent = [];
  alive = false;
  try {
    await sw.tick();
  } finally { alive = true; }
  const ev = (await get('events')).events.at(-1);
  assert.equal(ev.name, 'DESKTOP_CAPTURE_STOPPED');
  assert.deepEqual(ev.data, { reason: 'error', error: 'ping failed' });
  assert.ok(chrome.runtime.sent.some(m => m.type === 'holder' && m.name === 'ask'));
});

test('tick grabs a desktop frame while focus is away (floor under a throttled holder loop)', async () => {
  const holderId = (await desktop()).holderWindowId;
  await holderMsg({ name: 'started', width: 1920, height: 1080, pickMs: 100 }, holderId);
  await settle();
  for (const w of chrome.windows.list) w.focused = false;
  chrome.windows.onFocusChanged.emit(-1);
  await new Promise((r) => setTimeout(r, 650));
  await settle();
  assert.notEqual((await get('session')).session.away.focusAt, null);
  current = 'TICK_FRAME_1';
  const before = (await names()).filter(n => n === 'DESKTOP_FRAME').length;
  await sw.tick();
  await settle();
  const frames = (await get('events')).events.filter(e => e.name === 'DESKTOP_FRAME');
  assert.equal(frames.length, before + 1);
  assert.match(frames.at(-1).shot, /^screenshots\/desktop\//);
  current = 'TICK_FRAME_1';
  await sw.tick();
  await settle();
  assert.equal((await names()).filter(n => n === 'DESKTOP_FRAME').length, before + 1, 'same image is deduped');
  chrome.windows.list[0].focused = true;
  await chrome.windows.onFocusChanged.emit(3);
  await settle();
  current = 'TICK_FRAME_2';
  await sw.tick();
  await settle();
  assert.equal((await names()).filter(n => n === 'DESKTOP_FRAME').length, before + 1, 'no tick frame once focus is back');
});

test('every desktop message is answered, so the holder never waits on an open channel', async () => {
  const holderId = (await desktop()).holderWindowId;
  const answers = [];
  const respond = (r) => answers.push(r);
  await chrome.runtime.onMessage.emit({ type: 'desktop', name: 'frame', b64: 'ANSWERED' }, { tab: { id: 9, windowId: holderId } }, respond);
  await chrome.runtime.onMessage.emit({ type: 'desktop', name: 'ended' }, { tab: { id: 9, windowId: holderId } }, respond);
  await chrome.runtime.onMessage.emit({ type: 'desktop', name: 'ready' }, { tab: { id: 9, windowId: holderId } }, respond);
  await settle();
  assert.equal(answers.length, 3);
});
