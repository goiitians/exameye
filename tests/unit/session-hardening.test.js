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
