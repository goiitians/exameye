import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.js';

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

async function settle() {
  for (let i = 0; i < 4; i++) await sw.settled();
}

const get = (k) => chrome.storage.local.get(k);
const names = async () => (await get('events')).events.map(e => e.name);
const holderUrl = () => chrome.runtime.getURL('src/holder/holder.html');
const holderPopups = () => chrome.windows.list.filter(w => w.type === 'popup' && w.url === holderUrl());
const desktop = async () => (await get('meta')).meta.desktop;
const holderMsg = (m, wid) => chrome.runtime.onMessage.emit({ type: 'desktop', ...m }, { tab: { id: 9, windowId: wid } }, () => {});

test('start NAV opens one holder window and marks prompting; a second NAV does not open another', async () => {
  await chrome.webNavigation.onCommitted.emit({ tabId: 1, frameId: 0, url: 'https://e.x/start' });
  await settle();
  assert.equal(holderPopups().length, 1);
  const d1 = await desktop();
  assert.equal(d1.state, 'prompting');
  assert.equal(d1.asks, 1);
  await chrome.webNavigation.onCommitted.emit({ tabId: 1, frameId: 0, url: 'https://e.x/start?x=1' });
  await settle();
  assert.equal(holderPopups().length, 1);
  assert.equal((await desktop()).asks, 1);
});

test('holder window/tab inputs never reach the reducer', async () => {
  const holderId = (await desktop()).holderWindowId;
  const before = await names();
  await chrome.windows.onCreated.emit({ id: holderId, incognito: false });
  await chrome.tabs.onActivated.emit({ tabId: 9, windowId: holderId });
  await chrome.webNavigation.onCommitted.emit({ tabId: 9, frameId: 0, url: holderUrl() });
  await settle();
  assert.deepEqual(await names(), before);
});

test('ready from the holder is answered ask:true; from an unknown window close:true', async () => {
  const holderId = (await desktop()).holderWindowId;
  let resp;
  await chrome.runtime.onMessage.emit({ type: 'desktop', name: 'ready' }, { tab: { id: 9, windowId: holderId } }, (r) => { resp = r; });
  await settle();
  assert.deepEqual(resp, { ask: true });
  await chrome.runtime.onMessage.emit({ type: 'desktop', name: 'ready' }, { tab: { id: 99, windowId: 12345 } }, (r) => { resp = r; });
  await settle();
  assert.deepEqual(resp, { close: true });
});

test('desktop messages from a tab that is not the holder are ignored', async () => {
  const d = await desktop();
  assert.equal(d.state, 'prompting');
  assert.equal(d.holderTabId, 9);
  await chrome.runtime.onMessage.emit({ type: 'desktop', name: 'started', width: 1, height: 1, pickMs: 1 }, { tab: { id: 77, windowId: d.holderWindowId } }, () => {});
  await settle();
  assert.equal((await desktop()).state, 'prompting');
  const n = (await names()).length;
  await chrome.runtime.onMessage.emit({ type: 'desktop', name: 'frame', b64: 'QUJD' }, { tab: { id: 77, windowId: 5 } }, () => {});
  await settle();
  assert.equal((await names()).length, n);
});

test('started: on, minimised, DESKTOP_CAPTURE_STARTED with a tab shot, desktopAsk cleared', async () => {
  const holderId = (await desktop()).holderWindowId;
  const armedAt = (await get('meta')).meta.lastShot.at;
  const realNow = Date.now;
  Date.now = () => armedAt + 3000;
  try {
    await holderMsg({ name: 'started', width: 1920, height: 1080, pickMs: 2400 }, holderId);
    await settle();
  } finally { Date.now = realNow; }
  const d = await desktop();
  assert.equal(d.state, 'on');
  assert.ok(d.since);
  const win = chrome.windows.list.find(w => w.id === holderId);
  assert.equal(win.state, 'minimized');
  const events = (await get('events')).events;
  const ev = events.at(-1);
  assert.equal(ev.name, 'DESKTOP_CAPTURE_STARTED');
  assert.deepEqual(ev.data, { width: 1920, height: 1080, pickMs: 2400, screens: null });
  assert.match(ev.shot, /_DESKTOP_CAPTURE_STARTED\.jpg$/);
  assert.equal(chrome.alarms.alarms.desktopAsk, undefined);
});

test('cancelled: declined, DECLINED{asks:1}, alarm at +5 min; a start NAV inside the interval is silent; the alarm re-asks in the same window', async () => {
  const holderId = (await desktop()).holderWindowId;
  await holderMsg({ name: 'ended' }, holderId);
  await settle();
  await holderMsg({ name: 'ready' }, holderId);
  await settle();
  const beforeAsks = (await desktop()).asks;
  await holderMsg({ name: 'cancelled', pickMs: 500 }, holderId);
  await settle();
  const d = await desktop();
  assert.equal(d.state, 'declined');
  const ev = (await get('events')).events.at(-1);
  assert.equal(ev.name, 'DESKTOP_CAPTURE_DECLINED');
  assert.deepEqual(ev.data, { asks: beforeAsks });
  assert.equal(chrome.alarms.alarms.desktopAsk.when, d.at + 300000);

  chrome.tabs.sent = [];
  await chrome.webNavigation.onCommitted.emit({ tabId: 1, frameId: 0, url: 'https://e.x/start' });
  await settle();
  assert.ok(!chrome.tabs.sent.some(s => s.msg.name === 'ask'), 'no re-ask inside the reprompt interval');

  const realNow = Date.now;
  Date.now = () => d.at + 300000;
  try {
    await chrome.alarms.onAlarm.emit({ name: 'desktopAsk' });
    await settle();
  } finally { Date.now = realNow; }
  assert.deepEqual(chrome.tabs.sent.at(-1).msg, { type: 'holder', name: 'ask' });
  const win = chrome.windows.list.find(w => w.id === holderId);
  assert.equal(win.state, 'normal');
  const d2 = await desktop();
  assert.equal(d2.state, 'prompting');
  assert.equal(d2.asks, beforeAsks + 1);
});

test('SW to holder traffic is addressed to the holder tab, never broadcast', () => {
  assert.ok(!chrome.runtime.sent.some(m => m.type === 'holder'));
  assert.ok(chrome.tabs.sent.length > 0);
  assert.ok(chrome.tabs.sent.every(s => s.tabId === 9), JSON.stringify(chrome.tabs.sent.map(s => s.tabId)));
});

test('ended: STOPPED{reason:stop-sharing} then an immediate re-ask in the same window', async () => {
  const holderId = (await desktop()).holderWindowId;
  await holderMsg({ name: 'started', width: 1280, height: 720, pickMs: 100 }, holderId);
  await settle();
  chrome.tabs.sent = [];
  await holderMsg({ name: 'ended' }, holderId);
  await settle();
  const ev = (await get('events')).events.at(-1);
  assert.equal(ev.name, 'DESKTOP_CAPTURE_STOPPED');
  assert.deepEqual(ev.data, { reason: 'stop-sharing' });
  const d = await desktop();
  assert.equal(d.state, 'prompting');
  assert.equal(d.holderWindowId, holderId);
  assert.ok(chrome.tabs.sent.some(s => s.msg.name === 'ask'));
});

test('holder window closed while on: STOPPED{reason:window-closed} and a fresh holder window', async () => {
  const holderId = (await desktop()).holderWindowId;
  await holderMsg({ name: 'started', width: 1280, height: 720, pickMs: 100 }, holderId);
  await settle();
  await chrome.windows.remove(holderId);
  await settle();
  const events = (await get('events')).events;
  assert.equal(events.at(-1).name, 'DESKTOP_CAPTURE_STOPPED');
  assert.deepEqual(events.at(-1).data, { reason: 'window-closed' });
  assert.ok(!events.some(e => e.name === 'WINDOW_CLOSED'));
  const d = await desktop();
  assert.notEqual(d.holderWindowId, holderId);
  assert.equal(holderPopups().length, 1);
});

test('failed: error state and DESKTOP_CAPTURE_FAILED{error} with the alarm', async () => {
  const holderId = (await desktop()).holderWindowId;
  await holderMsg({ name: 'failed', error: 'NotAllowedError', pickMs: 50 }, holderId);
  await settle();
  const d = await desktop();
  assert.equal(d.state, 'error');
  assert.equal(d.error, 'NotAllowedError');
  const ev = (await get('events')).events.at(-1);
  assert.equal(ev.name, 'DESKTOP_CAPTURE_FAILED');
  assert.deepEqual(ev.data, { error: 'NotAllowedError' });
  assert.equal(chrome.alarms.alarms.desktopAsk.when, d.at + 300000);
});

test('arming while already on logs DESKTOP_CAPTURE_STARTED{resumed:true} and resets asks', async () => {
  await chrome.webNavigation.onCommitted.emit({ tabId: 1, frameId: 0, url: 'https://e.x/result' });
  await settle();
  assert.equal((await get('session')).session.state, 'IDLE');
  const { meta } = await get('meta');
  await chrome.storage.local.set({ meta: { ...meta, desktop: { ...meta.desktop, state: 'on', since: 1000, asks: 3, width: 640, height: 480 } } });
  await chrome.webNavigation.onCommitted.emit({ tabId: 1, frameId: 0, url: 'https://e.x/start' });
  await settle();
  assert.deepEqual(await names(), ['SESSION_ARMED', 'DESKTOP_CAPTURE_STARTED']);
  const ev = (await get('events')).events.at(-1);
  assert.equal(ev.data.resumed, true);
  assert.equal((await desktop()).asks, 0);
});

test('desktop messages while IDLE change meta only', async () => {
  await chrome.webNavigation.onCommitted.emit({ tabId: 1, frameId: 0, url: 'https://e.x/result' });
  await settle();
  assert.equal((await get('session')).session.state, 'IDLE');
  const holderId = (await desktop()).holderWindowId;
  const before = await names();
  await holderMsg({ name: 'cancelled', pickMs: 10 }, holderId);
  await settle();
  assert.deepEqual(await names(), before);
  assert.equal((await desktop()).state, 'off');
});

test('session end closes the holder, clears the alarm and resets desktop to off', async () => {
  await chrome.storage.local.set({ config: { ...config, endButton: 'Finish', tailMin: 0 } });
  chrome.tabs.list = [{ id: 1, windowId: 3, url: 'https://e.x/start', title: 'Exam', incognito: false, active: true }];
  await chrome.webNavigation.onCommitted.emit({ tabId: 1, frameId: 0, url: 'https://e.x/start' });
  await settle();
  assert.equal((await get('session')).session.state, 'ARMED');
  await chrome.webNavigation.onCommitted.emit({ tabId: 1, frameId: 0, url: 'https://e.x/result' });
  await settle();
  assert.equal((await get('session')).session.state, 'IDLE');
  assert.equal(holderPopups().length, 0);
  const d = await desktop();
  assert.equal(d.state, 'off');
  assert.equal(d.holderWindowId, null);
  await chrome.storage.local.set({ config });
});

test('desktopCapture off closes the holder and never opens one', async () => {
  chrome.tabs.list = [{ id: 1, windowId: 3, url: 'https://e.x/start', title: 'Exam', incognito: false, active: true }];
  await chrome.webNavigation.onCommitted.emit({ tabId: 1, frameId: 0, url: 'https://e.x/start' });
  await settle();
  assert.equal(holderPopups().length, 1);
  await chrome.storage.local.set({ config: { ...config, desktopCapture: 'off' } });
  await settle();
  assert.equal(holderPopups().length, 0);
  await chrome.webNavigation.onCommitted.emit({ tabId: 1, frameId: 0, url: 'https://e.x/result' });
  await settle();
  await chrome.webNavigation.onCommitted.emit({ tabId: 1, frameId: 0, url: 'https://e.x/start' });
  await settle();
  assert.equal(holderPopups().length, 0);
  await chrome.storage.local.set({ config });
});

test('desktopAsk while IDLE does nothing', async () => {
  await chrome.webNavigation.onCommitted.emit({ tabId: 1, frameId: 0, url: 'https://e.x/result' });
  await settle();
  assert.equal((await get('session')).session.state, 'IDLE');
  const before = holderPopups().length;
  await chrome.alarms.onAlarm.emit({ name: 'desktopAsk' });
  await settle();
  assert.equal(holderPopups().length, before);
});
