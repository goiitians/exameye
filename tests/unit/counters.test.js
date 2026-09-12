import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tally } from '../../src/core/counters.js';

const ev = (seq, t, name, data = {}, tabId) => ({ seq, t, ts: new Date(t).toISOString(), name, data, shot: null, ...(tabId !== undefined ? { tabId } : {}) });

test('counts, durations and parallel focused time', () => {
  const events = [
    ev(1, 0, 'SESSION_ARMED', { url: 's' }, 1),
    ev(2, 1000, 'TAB_SWITCH', { toTabId: 2 }, 2),
    ev(3, 1000, 'PARALLEL_PAGE', { url: 'https://a/', title: 'A', trigger: 'activated', incognito: false }, 2),
    ev(4, 3000, 'PARALLEL_PAGE', { url: 'https://b/', trigger: 'committed', incognito: false }, 2),
    ev(5, 6000, 'PARALLEL_PAGE', { url: 'https://c/', trigger: 'committed', incognito: false }, 9),
    ev(6, 7000, 'TAB_RETURN', { awayMs: 6000 }, 1),
    ev(7, 8000, 'FOCUS_LEFT_CHROME', {}),
    ev(8, 9500, 'FOCUS_RETURNED', { awayMs: 1500 }),
    ev(9, 10000, 'WINDOW_MINIMIZED', {}),
    ev(10, 12000, 'WINDOW_RESTORED', { minimizedMs: 2000 }),
    ev(11, 13000, 'IDLE_START', { state: 'idle' }),
    ev(12, 14000, 'IDLE_END', { idleMs: 1000 }),
    ev(13, 15000, 'PARALLEL_PAGE', { url: 'https://a/', title: 'A2', trigger: 'activated', incognito: false }, 2),
    ev(14, 16000, 'SESSION_DISARMED', { outcome: 'RESULT' }, 1),
  ];
  const t = tally(events);
  assert.equal(t.counts.PARALLEL_PAGE, 4);
  assert.equal(t.counts.TAB_SWITCH, 1);
  assert.deepEqual(t.durations, { tabAwayMs: 6000, focusLeftMs: 1500, minimizedMs: 2000, idleMs: 1000, screensaverMs: 0 });
  assert.deepEqual(t.attribution, { screensaver: 0, idle: 0, user: 1 });
  assert.deepEqual(t.parallel, [
    { url: 'https://b/', title: '', incognito: false, visits: 1, focusedMs: 4000 },
    { url: 'https://a/', title: 'A2', incognito: false, visits: 2, focusedMs: 3000 },
    { url: 'https://c/', title: '', incognito: false, visits: 1, focusedMs: 0 },
  ]);
});

test('empty input', () => {
  assert.deepEqual(tally([]), {
    counts: {},
    durations: { tabAwayMs: 0, focusLeftMs: 0, minimizedMs: 0, idleMs: 0, screensaverMs: 0 },
    parallel: [],
    attribution: { screensaver: 0, idle: 0, user: 0 },
  });
});

test('screensaver attribution: locked state during focus-left window classifies as screensaver', () => {
  const events = [
    ev(1, 1000, 'FOCUS_LEFT_CHROME'),
    ev(2, 1800, 'IDLE_START', { state: 'locked' }),
    ev(3, 2500, 'IDLE_END', { idleMs: 700 }),
    ev(4, 3000, 'FOCUS_RETURNED', { awayMs: 2000 }),
  ];
  const t = tally(events);
  assert.deepEqual(t.attribution, { screensaver: 1, idle: 0, user: 0 });
  assert.equal(t.durations.focusLeftMs, 0);
  assert.equal(t.durations.screensaverMs, 700);
  assert.equal(t.counts.SCREENSAVER, 1);
});

test('screensaver attribution: locked state up to 3s before focus loss still counts as screensaver', () => {
  const events = [
    ev(1, 0, 'IDLE_START', { state: 'locked' }),
    ev(2, 2000, 'FOCUS_LEFT_CHROME'),
    ev(3, 2500, 'IDLE_END', { idleMs: 2500 }),
    ev(4, 4000, 'FOCUS_RETURNED', { awayMs: 2000 }),
  ];
  const t = tally(events);
  assert.deepEqual(t.attribution, { screensaver: 1, idle: 0, user: 0 });
  assert.equal(t.durations.focusLeftMs, 0);
  assert.equal(t.durations.screensaverMs, 2500);
  assert.equal(t.counts.SCREENSAVER, 1);
});

test('idle attribution: idle state (not locked) inside the window classifies as idle', () => {
  const events = [
    ev(1, 1000, 'FOCUS_LEFT_CHROME'),
    ev(2, 1500, 'IDLE_START', { state: 'idle' }),
    ev(3, 1800, 'IDLE_END', { idleMs: 300 }),
    ev(4, 2000, 'FOCUS_RETURNED', { awayMs: 1000 }),
  ];
  const t = tally(events);
  assert.deepEqual(t.attribution, { screensaver: 0, idle: 1, user: 0 });
  assert.equal(t.durations.focusLeftMs, 0);
  assert.equal(t.durations.idleMs, 300);
  assert.equal(t.durations.screensaverMs, 0);
  assert.equal(t.counts.SCREENSAVER, undefined);
});

test('user attribution: no idle event in the window counts as user and adds to focusLeftMs', () => {
  const events = [
    ev(1, 1000, 'FOCUS_LEFT_CHROME'),
    ev(2, 3000, 'FOCUS_RETURNED', { awayMs: 2000 }),
  ];
  const t = tally(events);
  assert.deepEqual(t.attribution, { screensaver: 0, idle: 0, user: 1 });
  assert.equal(t.durations.focusLeftMs, 2000);
  assert.equal(t.durations.screensaverMs, 0);
});
