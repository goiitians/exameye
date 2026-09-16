import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initial, reduce } from '../../src/core/session.js';

const cfg = { startPrefix: 'https://e.x/start', examPrefix: 'https://e.x/', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10, startButton: '', endButton: '', endMarker: '', maxMin: 0, tailMin: 0, desktopCapture: 'off', desktopRepromptMin: 5 };
const T0 = Date.UTC(2026, 8, 15, 4, 0, 0);
const nav = (tabId, url, at = T0, windowId = 3) => ({ kind: 'NAV', tabId, windowId, url, at });
const activate = (tabId, windowId, url, at) => ({ kind: 'TAB_ACTIVATED', tabId, windowId, url, title: 'T', incognito: false, at });
const arm = () => reduce(initial(), nav(41, 'https://e.x/start?c=1'), cfg);
const names = (r) => r.events.map(e => e.name);
const cs = (name, data, tabId = 41, url = 'https://e.x/q/1', at = T0 + 500) => ({ kind: 'CS', name, data, tabId, windowId: 3, url, at });

test('exam tab activated in another window moves the exam window and tracking follows', () => {
  let r = reduce(arm().session, activate(41, 7, 'https://e.x/q/1', T0 + 1000), cfg);
  assert.deepEqual(names(r), ['EXAM_WINDOW_MOVED']);
  assert.deepEqual(r.events[0].data, { from: 3, to: 7 });
  assert.equal(r.session.examWindowId, 7);
  r = reduce(r.session, { kind: 'WINDOW_STATE', windowId: 7, state: 'minimized', at: T0 + 2000 }, cfg);
  assert.deepEqual(names(r), ['WINDOW_MINIMIZED']);
  r = reduce(r.session, { kind: 'WINDOW_STATE', windowId: 3, state: 'minimized', at: T0 + 3000 }, cfg);
  assert.deepEqual(names(r), []);
});

test('exam tab navigation from a new window also moves it; same window and windowId -1 emit nothing', () => {
  let r = reduce(arm().session, nav(41, 'https://e.x/q/2', T0 + 1000, 7), cfg);
  assert.deepEqual(names(r), ['EXAM_WINDOW_MOVED', 'EXAM_NAV']);
  r = reduce(r.session, activate(41, 7, 'https://e.x/q/2', T0 + 2000), cfg);
  assert.deepEqual(names(r), []);
  r = reduce(r.session, nav(41, 'https://e.x/q/3', T0 + 3000, -1), cfg);
  assert.deepEqual(names(r), ['EXAM_NAV']);
  assert.equal(r.session.examWindowId, 7);
});

test('a move out of a fullscreen window does not fake a FULLSCREEN_EXIT on the next tick', () => {
  let r = reduce(arm().session, { kind: 'WINDOW_STATE', windowId: 3, state: 'fullscreen', at: T0 + 1000 }, cfg);
  r = reduce(r.session, activate(41, 7, 'https://e.x/q/1', T0 + 2000), cfg);
  r = reduce(r.session, { kind: 'TICK', at: T0 + 3000, windows: [{ id: 7, state: 'normal' }], examTabPresent: true }, cfg);
  assert.deepEqual(names(r), []);
});

test('CONFIG_CHANGED with keys is logged while not IDLE; empty keys and IDLE emit nothing', () => {
  let r = reduce(arm().session, { kind: 'CONFIG_CHANGED', keys: ['tailMin'], at: T0 + 1000 }, cfg);
  assert.deepEqual(names(r), ['CONFIG_CHANGED']);
  assert.deepEqual(r.events[0].data, { keys: ['tailMin'] });
  r = reduce(r.session, { kind: 'CONFIG_CHANGED', keys: [], at: T0 + 2000 }, cfg);
  assert.deepEqual(names(r), []);
  assert.deepEqual(names(reduce(initial(), { kind: 'CONFIG_CHANGED', keys: ['seat'], at: T0 }, cfg)), []);
});

test('arm freezes the subfolder into the session', () => {
  assert.equal(arm().session.subfolder, 'ExamEye');
});

test('DRAG from the exam tab is logged with its data; from another tab it is dropped', () => {
  let r = reduce(arm().session, cs('DRAG', { len: 12, tag: 'P' }), cfg);
  assert.deepEqual(names(r), ['DRAG']);
  assert.deepEqual(r.events[0].data, { len: 12, tag: 'P' });
  r = reduce(r.session, cs('DRAG', { len: 12, tag: 'P' }, 42, 'https://g.x/'), cfg);
  assert.deepEqual(names(r), []);
});

test('CLOCK input emits CLOCK_BACKWARDS with the size of the jump', () => {
  const r = reduce(arm().session, { kind: 'CLOCK', at: T0 + 1000, lastSeenAt: T0 + 61000 }, cfg);
  assert.deepEqual(names(r), ['CLOCK_BACKWARDS']);
  assert.deepEqual(r.events[0].data, { lastSeenAt: T0 + 61000, backMs: 60000 });
});

test('MULTI_MONITOR is emitted once per session on the first STARTED with screens > 1', () => {
  const started = (screens, at) => ({ kind: 'DESKTOP', name: 'STARTED', data: { width: 1, height: 1, pickMs: 1, screens }, at });
  let r = reduce(arm().session, started(2, T0 + 1000), cfg);
  assert.deepEqual(names(r), ['DESKTOP_CAPTURE_STARTED', 'MULTI_MONITOR']);
  assert.deepEqual(r.events[1].data, { screens: 2 });
  r = reduce(r.session, started(2, T0 + 2000), cfg);
  assert.deepEqual(names(r), ['DESKTOP_CAPTURE_STARTED']);
  assert.deepEqual(names(reduce(arm().session, started(1, T0 + 1000), cfg)), ['DESKTOP_CAPTURE_STARTED']);
  assert.deepEqual(names(reduce(arm().session, started(null, T0 + 1000), cfg)), ['DESKTOP_CAPTURE_STARTED']);
});
