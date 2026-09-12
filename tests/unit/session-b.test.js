import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initial, reduce } from '../../src/core/session.js';

const cfg = { startPrefix: 'https://e.x/start', examPrefix: 'https://e.x/', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10 };
const T0 = 1789530302117;
const armed = () => reduce(initial(), { kind: 'NAV', tabId: 41, windowId: 3, url: 'https://e.x/start', at: T0 }, cfg).session;
const names = (r) => r.events.map(e => e.name);
const act = (tabId, at, extra = {}) => ({ kind: 'TAB_ACTIVATED', tabId, windowId: 3, url: 'https://g.x/', title: 'G', incognito: false, at, ...extra });

test('tab switch away, another parallel activation, then return with awayMs', () => {
  let r = reduce(armed(), act(42, T0 + 1000), cfg);
  assert.deepEqual(names(r), ['TAB_SWITCH', 'PARALLEL_PAGE']);
  assert.deepEqual(r.events[0].data, { toTabId: 42, toUrl: 'https://g.x/', toTitle: 'G', toWindowId: 3, incognito: false });
  assert.deepEqual(r.events[1].data, { url: 'https://g.x/', title: 'G', incognito: false, trigger: 'activated' });
  r = reduce(r.session, act(43, T0 + 2000), cfg);
  assert.deepEqual(names(r), ['PARALLEL_PAGE']);
  r = reduce(r.session, act(41, T0 + 4000), cfg);
  assert.deepEqual(names(r), ['TAB_RETURN']);
  assert.equal(r.events[0].data.awayMs, 3000);
  assert.equal(r.session.away.tabAt, null);
});

test('focus left/returned pair with duration, no duplicates', () => {
  let r = reduce(armed(), { kind: 'FOCUS', windowId: -1, at: T0 }, cfg);
  assert.deepEqual(names(r), ['FOCUS_LEFT_CHROME']);
  r = reduce(r.session, { kind: 'FOCUS', windowId: -1, at: T0 + 10 }, cfg);
  assert.deepEqual(names(r), []);
  r = reduce(r.session, { kind: 'FOCUS', windowId: 3, at: T0 + 2500 }, cfg);
  assert.deepEqual(r.events[0].data, { awayMs: 2500 });
});

test('window minimized/restored and fullscreen exit, exam window only', () => {
  let r = reduce(armed(), { kind: 'WINDOW_STATE', windowId: 9, state: 'minimized', at: T0 }, cfg);
  assert.deepEqual(names(r), []);
  r = reduce(r.session, { kind: 'WINDOW_STATE', windowId: 3, state: 'minimized', at: T0 }, cfg);
  assert.deepEqual(names(r), ['WINDOW_MINIMIZED']);
  r = reduce(r.session, { kind: 'WINDOW_STATE', windowId: 3, state: 'fullscreen', at: T0 + 7000 }, cfg);
  assert.deepEqual(r.events.map(e => [e.name, e.data]), [['WINDOW_RESTORED', { minimizedMs: 7000 }]]);
  r = reduce(r.session, { kind: 'WINDOW_STATE', windowId: 3, state: 'normal', at: T0 + 8000 }, cfg);
  assert.deepEqual(r.events.map(e => [e.name, e.data]), [['FULLSCREEN_EXIT', { source: 'window' }]]);
});

test('windows opened/closed, incognito flagged', () => {
  assert.deepEqual(names(reduce(armed(), { kind: 'WINDOW_CREATED', windowId: 5, incognito: true, at: T0 }, cfg)), ['INCOGNITO_WINDOW_OPENED']);
  assert.deepEqual(names(reduce(armed(), { kind: 'WINDOW_CREATED', windowId: 5, incognito: false, at: T0 }, cfg)), ['WINDOW_OPENED']);
  assert.deepEqual(names(reduce(armed(), { kind: 'WINDOW_REMOVED', windowId: 5, at: T0 }, cfg)), ['WINDOW_CLOSED']);
});

test('content-script events only from the exam tab; probes become effects', () => {
  const cs = (name, tabId = 41, data = {}) => ({ kind: 'CS', name, tabId, windowId: 3, data, at: T0 });
  assert.deepEqual(names(reduce(armed(), cs('COPY', 77), cfg)), []);
  let r = reduce(armed(), cs('PASTE', 41, { len: 12 }), cfg);
  assert.deepEqual(r.events.map(e => [e.name, e.data]), [['PASTE', { len: 12 }]]);
  assert.deepEqual(reduce(armed(), cs('FULLSCREEN_EXIT'), cfg).events[0].data, { source: 'document' });
  assert.deepEqual(reduce(armed(), cs('DEVTOOLS', 41, { dw: 300, dh: 0 }), cfg).events.map(e => e.name), ['DEVTOOLS_OPENED']);
  r = reduce(armed(), cs('VISIBILITY', 41, { hidden: true }), cfg);
  assert.deepEqual(r.events, []);
  assert.deepEqual(r.effects, [{ type: 'PROBE' }]);
});

test('idle start/end and download', () => {
  let r = reduce(armed(), { kind: 'IDLE', state: 'locked', at: T0 }, cfg);
  assert.deepEqual(r.events[0].data, { state: 'locked' });
  r = reduce(r.session, { kind: 'IDLE', state: 'active', at: T0 + 60000 }, cfg);
  assert.deepEqual(r.events.map(e => [e.name, e.data]), [['IDLE_END', { idleMs: 60000 }]]);
  r = reduce(armed(), { kind: 'DOWNLOAD', url: 'https://f.x/a.pdf', filename: 'a.pdf', mime: 'application/pdf', at: T0 }, cfg);
  assert.deepEqual(r.events.map(e => [e.name, e.data]), [['DOWNLOAD_STARTED', { url: 'https://f.x/a.pdf', filename: 'a.pdf', mime: 'application/pdf' }]]);
});

test('TICK reconciles window state and missing exam tab', () => {
  let r = reduce(armed(), { kind: 'TICK', at: T0, windows: [{ id: 3, state: 'minimized' }], examTabPresent: true }, cfg);
  assert.deepEqual(names(r), ['WINDOW_MINIMIZED']);
  r = reduce(r.session, { kind: 'TICK', at: T0 + 30000, windows: [{ id: 3, state: 'normal' }], examTabPresent: false }, cfg);
  assert.deepEqual(names(r), ['WINDOW_RESTORED', 'EXAM_TAB_CLOSED']);
  assert.equal(r.effects[0].type, 'ABANDON_ALARM_SET');
});

test('TICK with missing exam tab emits EXAM_TAB_CLOSED carrying tabId', () => {
  let r = reduce(armed(), { kind: 'TICK', at: T0 + 30000, windows: [{ id: 3, state: 'normal' }], examTabPresent: false }, cfg);
  const ev = r.events.find(e => e.name === 'EXAM_TAB_CLOSED');
  assert.ok(ev, 'expected EXAM_TAB_CLOSED event');
  assert.equal(ev.tabId, 41);
});
