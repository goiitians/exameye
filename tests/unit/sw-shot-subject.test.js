import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.js';

const chrome = installFakeChrome();
const config = { startPrefix: 'https://e.x/start', examPrefix: '', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10, startButton: '', endButton: '', endMarker: '', maxMin: 0, tailMin: 0, desktopCapture: 'off', desktopRepromptMin: 5 };
await chrome.storage.local.set({ config });
const sw = await import('../../src/sw.js');

const exam = { id: 1, windowId: 3, url: 'https://e.x/start', title: 'Exam', incognito: false, active: true };
const other = { id: 2, windowId: 3, url: 'https://g.x/', title: 'G', incognito: false, active: false };
chrome.tabs.list = [exam, other];
chrome.windows.list = [{ id: 3, focused: true, state: 'normal' }];
const activate = (tab) => { for (const t of chrome.tabs.list) t.active = t === tab; };

// the fake returns the image of the window's active tab at capture time, as Chrome does
const captures = [];
chrome.tabs.captureVisibleTab = async (windowId) => {
  const t = chrome.tabs.list.find(t => t.windowId === windowId && t.active);
  captures.push({ windowId, tabId: t?.id ?? null, at: Date.now() });
  return `data:image/jpeg;base64,TAB${t?.id}`;
};

const get = (k) => chrome.storage.local.get(k);
const byName = async (name) => (await get('events')).events.filter(e => e.name === name).at(-1);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const t0 = Date.now() - 60000;
await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start', at: t0 });
assert.equal((await get('session')).session.state, 'ARMED');

test('TAB_SWITCH within 2 s of a shot of the exam tab captures the new tab instead of reusing the file', async () => {
  await sw.dispatch({ kind: 'PERIODIC', at: t0 + 3000 });
  const periodic = await byName('PERIODIC');
  activate(other);
  await sw.dispatch({ kind: 'TAB_ACTIVATED', tabId: 2, windowId: 3, url: 'https://g.x/', title: 'G', incognito: false, at: t0 + 4000 });
  const { events, shots } = await get(['events', 'shots']);
  assert.deepEqual(events.slice(-2).map(e => e.name), ['TAB_SWITCH', 'PARALLEL_PAGE']);
  const sw1 = events.at(-2);
  assert.notEqual(sw1.shot, periodic.shot, 'a shot of the exam tab must not stand in for the switched-to tab');
  assert.equal(shots[sw1.shot], 'TAB2');
  assert.equal(events.at(-1).shot, sw1.shot, 'PARALLEL_PAGE of the same activation shares the same shot');
});

test('an exam-tab event within 2 s of the other tab\'s shot captures the exam tab afresh', async () => {
  const sw1 = await byName('TAB_SWITCH');
  activate(exam);
  await sw.dispatch({ kind: 'TAB_ACTIVATED', tabId: 1, windowId: 3, url: 'https://e.x/start', title: 'Exam', incognito: false, at: t0 + 4500 });
  await sw.dispatch({ kind: 'CS', name: 'COPY', tabId: 1, windowId: 3, data: { len: 3 }, at: t0 + 4800 });
  const { events, shots } = await get(['events', 'shots']);
  const copy = events.at(-1);
  assert.equal(copy.name, 'COPY');
  assert.notEqual(copy.shot, sw1.shot, 'a shot of the other tab must not stand in for the exam tab');
  assert.equal(shots[copy.shot], 'TAB1');
});

test('a navigation committed on the tab the candidate switched to is captured after it paints', async () => {
  activate(other);
  await sw.dispatch({ kind: 'TAB_ACTIVATED', tabId: 2, windowId: 3, url: 'https://g.x/', title: 'G', incognito: false, at: t0 + 6000 });
  other.status = 'loading';
  const before = captures.length;
  const started = Date.now();
  setTimeout(() => { other.status = 'complete'; }, 400);
  await sw.dispatch({ kind: 'NAV', tabId: 2, windowId: 3, url: 'https://g.x/search?q=answer', incognito: false, at: t0 + 9000 });
  const { events, shots } = await get(['events', 'shots']);
  const ev = events.at(-1);
  assert.equal(ev.name, 'PARALLEL_PAGE');
  assert.equal(ev.data.trigger, 'committed');
  assert.equal(captures.length, before + 1, 'one capture for the committed page');
  assert.ok(Date.now() - started >= 400, 'the capture waited for the page to finish loading');
  assert.equal(shots[ev.shot], 'TAB2');
  delete other.status;
  activate(exam);
  await sw.dispatch({ kind: 'TAB_ACTIVATED', tabId: 1, windowId: 3, url: 'https://e.x/start', title: 'Exam', incognito: false, at: t0 + 9500 });
});

test('a capture refused at activation time is retried from the queue while the switched-to tab is still visible', async () => {
  const real = chrome.tabs.captureVisibleTab;
  let refuse = 1;
  chrome.tabs.captureVisibleTab = async (w) => { if (refuse-- > 0) throw new Error('quota'); return real(w); };
  try {
    activate(other);
    await chrome.tabs.onActivated.emit({ tabId: 2, windowId: 3 });
    await sw.settled();
    const { events, shots } = await get(['events', 'shots']);
    const sw1 = events.filter(e => e.name === 'TAB_SWITCH').at(-1);
    assert.equal(sw1.data.shotError, undefined);
    assert.equal(shots[sw1.shot], 'TAB2');
  } finally { chrome.tabs.captureVisibleTab = real; }
  activate(exam);
  await sw.dispatch({ kind: 'TAB_ACTIVATED', tabId: 1, windowId: 3, url: 'https://e.x/start', title: 'Exam', incognito: false, at: Date.now() });
});

test('a capture refused at activation time keeps the error when the candidate has already flipped back', async () => {
  const real = chrome.tabs.captureVisibleTab;
  chrome.tabs.captureVisibleTab = async () => { throw new Error('quota'); };
  const { meta } = await get('meta');
  await chrome.storage.local.set({ meta: { ...meta, desktop: { state: 'on', at: t0, since: t0, holderWindowId: 50, holderTabId: 9, asks: 1, width: 1, height: 1, error: null, nextAskAt: null, screens: 1 } } });
  chrome.tabs.responder = (m) => m.name === 'grab' ? wait(600).then(() => ({ b64: 'DESKTOP', alive: true })) : undefined;
  try {
    const periodic = sw.dispatch({ kind: 'PERIODIC', at: Date.now() });
    await wait(50);
    activate(other);
    const before = captures.length;
    // not awaited: the listener's refused capture may sit in the quota throttle; the flip back
    // must land before the queue reaches the activation either way
    const emitted = chrome.tabs.onActivated.emit({ tabId: 2, windowId: 3 });
    await wait(200);
    activate(exam);
    await periodic;
    await emitted;
    await sw.settled();
    const { events } = await get('events');
    const sw1 = events.filter(e => e.name === 'TAB_SWITCH').at(-1);
    assert.equal(sw1.shot, null);
    assert.equal(sw1.data.shotError, 'quota');
    assert.equal(captures.length, before, 'no capture may stand in for the switched-to tab');
  } finally {
    chrome.tabs.captureVisibleTab = real;
    await chrome.storage.local.set({ meta: { ...(await get('meta')).meta, desktop: meta.desktop } });
    chrome.tabs.responder = null;
    activate(exam);
    await sw.dispatch({ kind: 'TAB_ACTIVATED', tabId: 1, windowId: 3, url: 'https://e.x/start', title: 'Exam', incognito: false, at: Date.now() });
  }
});

test('a commit on the away tab after the candidate flipped back is an error, never a shot of the exam tab', async () => {
  activate(other);
  await sw.dispatch({ kind: 'TAB_ACTIVATED', tabId: 2, windowId: 3, url: 'https://g.x/', title: 'G', incognito: false, at: t0 + 40000 });
  // the flip back has happened on screen but its TAB_ACTIVATED has not been processed yet
  activate(exam);
  const before = captures.length;
  await sw.dispatch({ kind: 'NAV', tabId: 2, windowId: 3, url: 'https://g.x/search?q=late', incognito: false, at: t0 + 41000 });
  const ev = (await get('events')).events.at(-1);
  assert.equal(ev.name, 'PARALLEL_PAGE');
  assert.equal(ev.data.active, true);
  assert.equal(ev.shot, null);
  assert.equal(ev.data.shotError, 'tab no longer visible');
  assert.equal(captures.length, before);
  await sw.dispatch({ kind: 'TAB_ACTIVATED', tabId: 1, windowId: 3, url: 'https://e.x/start', title: 'Exam', incognito: false, at: t0 + 41500 });
});

test('two events on the same tab within 2 s still share one file', async () => {
  const before = captures.length;
  await sw.dispatch({ kind: 'PERIODIC', at: t0 + 10000 });
  await sw.dispatch({ kind: 'PERIODIC', at: t0 + 10500 });
  const { events } = await get('events');
  assert.equal(events.at(-1).shot, events.at(-2).shot);
  assert.equal(captures.length, before + 1);
});

test('the holder window is never the subject of a tab screenshot', async () => {
  chrome.windows.list = [{ id: 3, focused: false, state: 'normal' }, { id: 50, focused: true, state: 'normal' }];
  chrome.tabs.list = [exam, other, { id: 9, windowId: 50, url: chrome.runtime.getURL('src/holder/holder.html'), title: 'ExamEye capture', incognito: false, active: true }];
  const { meta } = await get('meta');
  await chrome.storage.local.set({ meta: { ...meta, desktop: { state: 'prompting', at: t0, since: null, holderWindowId: 50, holderTabId: 9, asks: 1, width: null, height: null, error: null, nextAskAt: null, screens: null } } });
  try {
    await sw.dispatch({ kind: 'PERIODIC', at: t0 + 20000 });
    const { events, shots } = await get(['events', 'shots']);
    assert.equal(captures.at(-1).windowId, 3, 'captured window must be the exam window, not the focused holder');
    assert.equal(shots[events.at(-1).shot], 'TAB1');
  } finally {
    await chrome.storage.local.set({ meta: { ...meta } });
    chrome.windows.list = [{ id: 3, focused: true, state: 'normal' }];
    chrome.tabs.list = [exam, other];
  }
});

// Lead 3 measurement: the queue is serial, so a TAB_ACTIVATED behind a step that waits (a
// NAV_BORN paint wait, a holder grab round trip) is captured that much later. A candidate who
// flips to another tab and back inside that delay would be logged with a shot of the exam tab.
test('a tab switch that is undone before the queue reaches it is still captured at activation time', async () => {
  const { meta } = await get('meta');
  await chrome.storage.local.set({ meta: { ...meta, desktop: { state: 'on', at: t0, since: t0, holderWindowId: 50, holderTabId: 9, asks: 1, width: 1, height: 1, error: null, nextAskAt: null, screens: 1 } } });
  chrome.tabs.responder = (m) => m.name === 'grab' ? wait(1500).then(() => ({ b64: 'DESKTOP', alive: true })) : undefined;
  try {
    // PERIODIC's holder round trip holds the queue for 1.5 s; the flip below is queued behind it
    const periodic = sw.dispatch({ kind: 'PERIODIC', at: t0 + 30000 });
    await wait(50);
    const flipAt = Date.now();
    activate(other);
    await chrome.tabs.onActivated.emit({ tabId: 2, windowId: 3 });
    await wait(300);
    activate(exam);
    await periodic;
    await sw.settled();
    const { events, shots } = await get(['events', 'shots']);
    const sw1 = events.filter(e => e.name === 'TAB_SWITCH').at(-1);
    assert.ok(sw1.t >= t0 + 30000, 'TAB_SWITCH must be the one logged after PERIODIC');
    const cap = captures.find(c => c.at >= flipAt);
    assert.ok(cap, 'a capture must have run after the flip');
    assert.equal(shots[sw1.shot], 'TAB2', `TAB_SWITCH shot shows the wrong tab; capture ran ${cap.at - flipAt} ms after activation`);
  } finally {
    await chrome.storage.local.set({ meta: { ...(await get('meta')).meta, desktop: meta.desktop } });
    chrome.tabs.responder = null;
    activate(exam);
  }
});
