import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initial, reduce } from '../../src/core/session.js';
import { tally } from '../../src/core/counters.js';

const cfg = { startPrefix: 'https://e.x/start', examPrefix: 'https://e.x/', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10, startButton: '', endButton: '', endMarker: '', maxMin: 0, tailMin: 0 };
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

test('re-activating the same parallel tab (windows.onFocusChanged + tabs.onActivated both firing) counts one PARALLEL_PAGE', () => {
  let r = reduce(armed(), act(42, T0 + 1000), cfg);
  assert.deepEqual(names(r), ['TAB_SWITCH', 'PARALLEL_PAGE']);
  r = reduce(r.session, act(42, T0 + 1005), cfg);
  assert.deepEqual(names(r), []);
  r = reduce(r.session, act(42, T0 + 3000, { url: 'https://g.x/other' }), cfg);
  assert.deepEqual(names(r), ['PARALLEL_PAGE']);
  r = reduce(r.session, act(43, T0 + 4000), cfg);
  assert.deepEqual(names(r), ['PARALLEL_PAGE']);
  r = reduce(r.session, act(41, T0 + 5000), cfg);
  assert.deepEqual(names(r), ['TAB_RETURN']);
  r = reduce(r.session, act(42, T0 + 6000), cfg);
  assert.deepEqual(names(r), ['TAB_SWITCH', 'PARALLEL_PAGE']);
});

test('a parallel tab that navigates is recorded once (committed), not again on the next synthetic activation', () => {
  let r = reduce(armed(), act(42, T0 + 1000), cfg);
  r = reduce(r.session, { kind: 'NAV', tabId: 42, windowId: 3, url: 'https://g.x/search?q=answer', incognito: false, at: T0 + 2000 }, cfg);
  assert.deepEqual(names(r), ['PARALLEL_PAGE']);
  assert.equal(r.events[0].data.trigger, 'committed');
  r = reduce(r.session, act(42, T0 + 2500, { url: 'https://g.x/search?q=answer' }), cfg);
  assert.deepEqual(names(r), []);
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

test('idle -> locked closes the idle interval and opens a new one; repeating the same state is silent', () => {
  let r = reduce(armed(), { kind: 'IDLE', state: 'idle', at: T0 }, cfg);
  assert.deepEqual(names(r), ['IDLE_START']);
  r = reduce(r.session, { kind: 'IDLE', state: 'idle', at: T0 + 30000 }, cfg);
  assert.deepEqual(names(r), []);
  r = reduce(r.session, { kind: 'IDLE', state: 'locked', at: T0 + 60000 }, cfg);
  assert.deepEqual(r.events.map(e => [e.name, e.data]), [['IDLE_END', { idleMs: 60000 }], ['IDLE_START', { state: 'locked' }]]);
});

test('active->idle->locked->active: tally attributes idleMs and screensaverMs to the right segments', () => {
  let r = reduce(armed(), { kind: 'IDLE', state: 'idle', at: T0 }, cfg);
  const events = [...r.events];
  r = reduce(r.session, { kind: 'IDLE', state: 'locked', at: T0 + 60000 }, cfg);
  events.push(...r.events);
  r = reduce(r.session, { kind: 'IDLE', state: 'active', at: T0 + 120000 }, cfg);
  events.push(...r.events);
  assert.deepEqual(events.map(e => [e.name, e.data]), [
    ['IDLE_START', { state: 'idle' }],
    ['IDLE_END', { idleMs: 60000 }],
    ['IDLE_START', { state: 'locked' }],
    ['IDLE_END', { idleMs: 60000 }],
  ]);
  const t = tally(events);
  assert.equal(t.durations.idleMs, 60000);
  assert.equal(t.durations.screensaverMs, 60000);
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

const tailCfg = { ...cfg, tailMin: 5, endButton: 'Finish', endMarker: 'submitted', maxMin: 60 };
const armCs = (tabId = 41, url) => reduce(initial(), { kind: 'NAV', tabId, windowId: 3, url: url ?? 'https://e.x/start', at: T0 }, tailCfg).session;
const cs = (name, data, tabId = 41, at = T0 + 1000) => ({ kind: 'CS', name, data, tabId, windowId: 3, at });
const closingSession = () => reduce(armCs(), cs('END_CLICK', { label: 'finish' }), tailCfg).session;

test('END_CLICK on the exam tab logs END_BUTTON_CLICKED and enters CLOSING as SUBMITTED', () => {
  const r = reduce(armCs(), cs('END_CLICK', { label: 'finish' }), tailCfg);
  assert.deepEqual(names(r), ['END_BUTTON_CLICKED']);
  assert.equal(r.events[0].data.phase, undefined);
  assert.equal(r.session.state, 'CLOSING');
  assert.equal(r.session.outcome, 'SUBMITTED');
  assert.equal(r.session.trigger, 'button');
  assert.equal(r.session.triggerLabel, 'finish');
  assert.equal(r.session.examEndedAt, T0 + 1000);
  assert.equal(r.session.closingUntil, T0 + 1000 + 300000);
  assert.equal(r.session.endClickAt, T0 + 1000);
  assert.deepEqual(r.effects, [{ type: 'MAX_ALARM_CLEAR' }, { type: 'CLOSING_ALARM_SET', when: T0 + 1000 + 300000 }]);
});

test('END_CLICK from another tab is ignored', () => {
  const r = reduce(armCs(), cs('END_CLICK', { label: 'finish' }, 77), tailCfg);
  assert.deepEqual(names(r), []);
  assert.equal(r.session.state, 'ARMED');
});

test('END_MARKER enters CLOSING as AUTO_SUBMITTED and fires once', () => {
  let r = reduce(armCs(), cs('END_MARKER', { marker: 'submitted' }), tailCfg);
  assert.deepEqual(names(r), ['END_MARKER_SEEN']);
  assert.equal(r.session.state, 'CLOSING');
  assert.equal(r.session.outcome, 'AUTO_SUBMITTED');
  assert.equal(r.session.trigger, 'marker');
  assert.equal(r.session.markerSeen, true);
  r = reduce(r.session, cs('END_MARKER', { marker: 'submitted' }, 41, T0 + 2000), tailCfg);
  assert.deepEqual(names(r), []);
});

test('result NAV on the exam tab emits RESULT_PAGE and enters CLOSING as RESULT', () => {
  const r = reduce(armCs(), { kind: 'NAV', tabId: 41, windowId: 3, url: 'https://e.x/result/9', at: T0 + 1000 }, tailCfg);
  assert.deepEqual(names(r), ['RESULT_PAGE']);
  assert.equal(r.session.state, 'CLOSING');
  assert.equal(r.session.outcome, 'RESULT');
  assert.equal(r.session.trigger, 'result');
  assert.equal(r.session.triggerLabel, 'https://e.x/result/9');
  const r2 = reduce(armCs(), { kind: 'NAV', tabId: 77, windowId: 4, url: 'https://e.x/result/9', at: T0 + 1000 }, tailCfg);
  assert.deepEqual(names(r2), ['RESULT_PAGE']);
  assert.equal(r2.session.state, 'CLOSING');
  assert.equal(r2.events[0].tabId, 77);
  assert.equal(r2.events[0].windowId, 4);
});

test('MAX_TIMER with the tab present emits MAX_TIME_REACHED and enters CLOSING as TIMED_OUT', () => {
  const s = armCs();
  const r = reduce(s, { kind: 'MAX_TIMER', at: T0 + 3600000 }, tailCfg);
  assert.deepEqual(names(r), ['MAX_TIME_REACHED']);
  assert.equal(r.events[0].tabId, s.examTabId);
  assert.equal(r.events[0].windowId, s.examWindowId);
  assert.equal(r.events[0].data.maxAt, s.maxAt);
  assert.equal(r.session.state, 'CLOSING');
  assert.equal(r.session.outcome, 'TIMED_OUT');
});

test('MAX_TIMER with the tab lost ends immediately', () => {
  let r = reduce(armCs(), { kind: 'TAB_REMOVED', tabId: 41, at: T0 + 100 }, tailCfg);
  r = reduce(r.session, { kind: 'MAX_TIMER', at: T0 + 3600000 }, tailCfg);
  assert.deepEqual(names(r), ['MAX_TIME_REACHED', 'SESSION_DISARMED']);
  assert.deepEqual(r.events[1].data, { outcome: 'TIMED_OUT', trigger: 'max' });
  assert.equal(r.session.state, 'IDLE');
  const types = r.effects.map(e => e.type);
  assert.ok(types.includes('ABANDON_ALARM_CLEAR'));
  assert.ok(types.includes('END'));
});

test('tailMin 0 ends immediately on any trigger', () => {
  const noTailCfg = { ...tailCfg, tailMin: 0 };
  const s = reduce(initial(), { kind: 'NAV', tabId: 41, windowId: 3, url: 'https://e.x/start', at: T0 }, noTailCfg).session;
  const r = reduce(s, cs('END_CLICK', { label: 'finish' }), noTailCfg);
  assert.deepEqual(names(r), ['END_BUTTON_CLICKED', 'SESSION_DISARMED']);
  assert.deepEqual(r.events[1].data, { outcome: 'SUBMITTED', trigger: 'button', label: 'finish' });
  assert.equal(r.session.state, 'IDLE');
  assert.equal(r.effects[0].type, 'MAX_ALARM_CLEAR');
  assert.equal(r.effects.at(-1).type, 'END');
});

test('ABANDON_TIMER disarm carries trigger abandon and clears the max alarm', () => {
  let r = reduce(armCs(), { kind: 'TAB_REMOVED', tabId: 41, at: T0 + 100 }, tailCfg);
  r = reduce(r.session, { kind: 'ABANDON_TIMER', at: T0 + 600100 }, tailCfg);
  assert.deepEqual(r.events[0].data, { outcome: 'ABANDONED', trigger: 'abandon' });
  assert.deepEqual(r.effects, [{ type: 'MAX_ALARM_CLEAR' }, { type: 'END', outcome: 'ABANDONED', session: r.effects[1].session }]);
  assert.equal(r.session.state, 'IDLE');
});

test('events in CLOSING carry phase tail and normal monitoring continues', () => {
  const closing = closingSession();
  let r = reduce(closing, { kind: 'TAB_ACTIVATED', tabId: 99, windowId: 3, url: 'https://g.x/', title: 'G', incognito: false, at: T0 + 2000 }, tailCfg);
  assert.deepEqual(names(r), ['TAB_SWITCH', 'PARALLEL_PAGE']);
  assert.equal(r.events[0].data.phase, 'tail');
  assert.equal(r.events[0].data.toUrl, 'https://g.x/');
  r = reduce(closing, cs('COPY', { len: 5 }), tailCfg);
  assert.deepEqual(names(r), ['COPY']);
  assert.equal(r.events[0].data.phase, 'tail');
});

test('END_CLICK in CLOSING resets closingUntil and re-sets the alarm; outcome unchanged', () => {
  const closing = closingSession();
  const r = reduce(closing, cs('END_CLICK', { label: 'finish' }, 41, T0 + 5000), tailCfg);
  assert.deepEqual(names(r), ['END_BUTTON_CLICKED']);
  assert.equal(r.session.state, 'CLOSING');
  assert.equal(r.session.outcome, 'SUBMITTED');
  assert.equal(r.session.closingUntil, T0 + 5000 + 300000);
  assert.deepEqual(r.effects, [{ type: 'CLOSING_ALARM_SET', when: T0 + 5000 + 300000 }]);
});

test('START_CLICK in CLOSING is logged only', () => {
  const closing = closingSession();
  const r = reduce(closing, cs('START_CLICK', { label: 'start' }), tailCfg);
  assert.deepEqual(names(r), ['START_BUTTON_CLICKED']);
  assert.equal(r.session.state, 'CLOSING');
});

test('SCREEN_CHANGED is ignored in ARMED and logged with hash in CLOSING', () => {
  let r = reduce(armCs(), cs('SCREEN_CHANGED', { hash: 'abcd1234' }), tailCfg);
  assert.deepEqual(r.events, []);
  const closing = closingSession();
  r = reduce(closing, cs('SCREEN_CHANGED', { hash: 'abcd1234' }), tailCfg);
  assert.deepEqual(names(r), ['SCREEN_CHANGED']);
  assert.deepEqual(r.events[0].data, { phase: 'tail', hash: 'abcd1234' });
});

test('result NAV in CLOSING is just EXAM_NAV; other-tab result is PARALLEL_PAGE', () => {
  const closing = closingSession();
  let r = reduce(closing, { kind: 'NAV', tabId: 41, windowId: 3, url: 'https://e.x/result/1', at: T0 + 2000 }, tailCfg);
  assert.deepEqual(names(r), ['EXAM_NAV']);
  r = reduce(closing, { kind: 'NAV', tabId: 77, windowId: 4, url: 'https://e.x/result/1', at: T0 + 2000 }, tailCfg);
  assert.deepEqual(names(r), ['PARALLEL_PAGE']);
  assert.equal(r.events[0].data.trigger, 'committed');
});

test('exam tab removed in CLOSING ends immediately', () => {
  const closing = closingSession();
  let r = reduce(closing, { kind: 'TAB_REMOVED', tabId: 41, at: T0 + 2000 }, tailCfg);
  assert.deepEqual(names(r), ['EXAM_TAB_CLOSED', 'SESSION_DISARMED']);
  assert.deepEqual(r.events[1].data, { phase: 'tail', outcome: 'SUBMITTED', trigger: 'button', label: 'finish' });
  assert.deepEqual(r.effects.map(e => e.type), ['CLOSING_ALARM_CLEAR', 'MAX_ALARM_CLEAR', 'END']);
  assert.equal(r.session.state, 'IDLE');
  assert.ok(!r.effects.some(e => e.type === 'ABANDON_ALARM_SET'));

  r = reduce(closing, { kind: 'TICK', at: T0 + 2000, windows: [{ id: 3, state: 'normal' }], examTabPresent: false }, tailCfg);
  assert.deepEqual(names(r), ['EXAM_TAB_CLOSED', 'SESSION_DISARMED']);
  assert.equal(r.session.state, 'IDLE');
});

test('CLOSING_TIMER disarms with the stored outcome from the exam window', () => {
  const closing = closingSession();
  const r = reduce(closing, { kind: 'CLOSING_TIMER', at: closing.closingUntil }, tailCfg);
  assert.deepEqual(names(r), ['SESSION_DISARMED']);
  assert.equal(r.events[0].tabId, closing.examTabId);
  assert.equal(r.events[0].windowId, closing.examWindowId);
  assert.equal(r.session.state, 'IDLE');
});

test('STARTUP in CLOSING re-adopts the tab and re-sets the closing alarm', () => {
  const closing = closingSession();
  const r = reduce(closing, { kind: 'STARTUP', at: closing.closingUntil - 1000, examTabs: [{ tabId: 9, windowId: 2, url: 'https://e.x/submitted' }] }, tailCfg);
  assert.deepEqual(r.events, []);
  assert.equal(r.session.examTabId, 9);
  assert.deepEqual(r.effects, [{ type: 'CLOSING_ALARM_SET', when: closing.closingUntil }]);
  assert.equal(r.session.state, 'CLOSING');
});

test('STARTUP in CLOSING after closingUntil ends now', () => {
  const closing = closingSession();
  const r = reduce(closing, { kind: 'STARTUP', at: closing.closingUntil + 1000, examTabs: [{ tabId: 9, windowId: 2, url: 'https://e.x/submitted' }] }, tailCfg);
  assert.deepEqual(names(r), ['SESSION_DISARMED']);
  assert.equal(r.session.state, 'IDLE');
});

test('STARTUP in CLOSING with no tab ends now', () => {
  const closing = closingSession();
  const r = reduce(closing, { kind: 'STARTUP', at: closing.closingUntil - 1000, examTabs: [] }, tailCfg);
  assert.deepEqual(names(r), ['SESSION_DISARMED']);
  assert.equal(r.session.state, 'IDLE');
});

const desk = (name, data, at = T0 + 1000) => ({ kind: 'DESKTOP', name, data, at });

test('DESKTOP STARTED/DECLINED/STOPPED/FAILED/FRAME become DESKTOP_* events with data copied', () => {
  const cases = [
    ['STARTED', { width: 1920, height: 1080, pickMs: 300 }, 'DESKTOP_CAPTURE_STARTED'],
    ['DECLINED', { asks: 2 }, 'DESKTOP_CAPTURE_DECLINED'],
    ['STOPPED', { reason: 'stop-sharing' }, 'DESKTOP_CAPTURE_STOPPED'],
    ['FAILED', { error: 'NotAllowedError' }, 'DESKTOP_CAPTURE_FAILED'],
    ['FRAME', { n: 1 }, 'DESKTOP_FRAME'],
  ];
  for (const [name, data, eventName] of cases) {
    const r = reduce(armed(), desk(name, data), cfg);
    assert.deepEqual(names(r), [eventName]);
    assert.deepEqual(r.events[0].data, data);
    assert.equal('tabId' in r.events[0], false);
    assert.equal('windowId' in r.events[0], false);
    assert.equal(r.session.state, 'ARMED');
  }
});

test('DESKTOP in CLOSING carries phase tail', () => {
  const closing = closingSession();
  const r = reduce(closing, desk('FRAME', { n: 1 }, T0 + 5000), tailCfg);
  assert.deepEqual(names(r), ['DESKTOP_FRAME']);
  assert.equal(r.events[0].data.phase, 'tail');
});

test('DESKTOP while IDLE emits nothing', () => {
  const r = reduce(initial(), desk('STARTED', { width: 1, height: 1, pickMs: 1 }), cfg);
  assert.deepEqual(r.events, []);
  assert.equal(r.session.state, 'IDLE');
});

test('stale MAX_TIMER / ABANDON_TIMER in CLOSING and CLOSING_TIMER in ARMED are no-ops', () => {
  const closing = closingSession();
  assert.deepEqual(reduce(closing, { kind: 'MAX_TIMER', at: T0 + 2000 }, tailCfg).events, []);
  assert.deepEqual(reduce(closing, { kind: 'ABANDON_TIMER', at: T0 + 2000 }, tailCfg).events, []);
  const armedS = armCs();
  const r = reduce(armedS, { kind: 'CLOSING_TIMER', at: T0 + 2000 }, tailCfg);
  assert.deepEqual(r.events, []);
  assert.equal(r.session.state, 'ARMED');
});
