import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initial, reduce } from '../../src/core/session.js';

const cfg = { startPrefix: 'https://e.x/start', examPrefix: 'https://e.x/', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10 };
const T0 = Date.UTC(2026, 8, 12, 3, 45, 2);
const nav = (tabId, url, at = T0, windowId = 3) => ({ kind: 'NAV', tabId, windowId, url, at });
const arm = () => reduce(initial(), nav(41, 'https://e.x/start?c=1'), cfg);
const names = (r) => r.events.map(e => e.name);

test('IDLE ignores non-start navigations', () => {
  const r = reduce(initial(), nav(41, 'https://e.x/result'), cfg);
  assert.equal(r.session.state, 'IDLE');
  assert.deepEqual(r.events, []);
});

test('IDLE + start navigation arms and emits SESSION_ARMED with seq 1', () => {
  const r = arm();
  assert.equal(r.session.state, 'ARMED');
  assert.equal(r.session.examTabId, 41);
  assert.equal(r.session.examWindowId, 3);
  assert.match(r.session.id, /^\d{8}-\d{6}_A17$/);
  assert.deepEqual(names(r), ['SESSION_ARMED']);
  assert.equal(r.events[0].seq, 1);
  assert.equal(r.events[0].tabId, 41);
  assert.deepEqual(r.effects, [{ type: 'ABANDON_ALARM_CLEAR' }]);
});

test('exam tab navigation emits EXAM_NAV only when the url changes', () => {
  let r = reduce(arm().session, nav(41, 'https://e.x/q/1', T0 + 1000), cfg);
  assert.deepEqual(names(r), ['EXAM_NAV']);
  r = reduce(r.session, nav(41, 'https://e.x/q/1', T0 + 2000), cfg);
  assert.deepEqual(names(r), []);
});

test('result on the exam tab disarms with END effect carrying the session snapshot', () => {
  const armed = arm().session;
  const r = reduce(armed, nav(41, 'https://e.x/result/9', T0 + 5000), cfg);
  assert.equal(r.session.state, 'IDLE');
  assert.deepEqual(names(r), ['SESSION_DISARMED']);
  assert.deepEqual(r.events[0].data, { outcome: 'RESULT', url: 'https://e.x/result/9' });
  assert.equal(r.effects[0].type, 'END');
  assert.equal(r.effects[0].session.id, armed.id);
});

test('result in another tab does not disarm; it is a parallel page', () => {
  const r = reduce(arm().session, nav(77, 'https://e.x/result/9', T0 + 5000), cfg);
  assert.equal(r.session.state, 'ARMED');
  assert.deepEqual(names(r), ['PARALLEL_PAGE']);
  assert.equal(r.events[0].data.trigger, 'committed');
});

test('exam tab removed -> EXAM_TAB_CLOSED and abandon alarm; re-adoption by URL clears it', () => {
  let r = reduce(arm().session, { kind: 'TAB_REMOVED', tabId: 41, at: T0 + 10 }, cfg);
  assert.deepEqual(names(r), ['EXAM_TAB_CLOSED']);
  assert.equal(r.session.tabLostAt, T0 + 10);
  assert.deepEqual(r.effects, [{ type: 'ABANDON_ALARM_SET', when: T0 + 10 + 600000 }]);
  r = reduce(r.session, nav(52, 'https://e.x/q/3', T0 + 20, 4), cfg);
  assert.deepEqual(names(r), ['EXAM_NAV']);
  assert.equal(r.events[0].data.adopted, true);
  assert.equal(r.session.examTabId, 52);
  assert.equal(r.session.tabLostAt, null);
  assert.deepEqual(r.effects, [{ type: 'ABANDON_ALARM_CLEAR' }]);
});

test('re-adoption on a result URL disarms in the same reduce', () => {
  let r = reduce(arm().session, { kind: 'TAB_REMOVED', tabId: 41, at: T0 + 10 }, cfg);
  r = reduce(r.session, nav(52, 'https://e.x/result/1', T0 + 20), cfg);
  assert.deepEqual(names(r), ['EXAM_NAV', 'SESSION_DISARMED']);
  assert.equal(r.session.state, 'IDLE');
});

test('ABANDON_TIMER ends the session only while the tab is lost', () => {
  assert.deepEqual(reduce(arm().session, { kind: 'ABANDON_TIMER', at: T0 }, cfg).events, []);
  let r = reduce(arm().session, { kind: 'TAB_REMOVED', tabId: 41, at: T0 }, cfg);
  r = reduce(r.session, { kind: 'ABANDON_TIMER', at: T0 + 600000 }, cfg);
  assert.deepEqual(r.events[0].data, { outcome: 'ABANDONED' });
  assert.equal(r.effects[0].type, 'END');
  assert.equal(r.session.state, 'IDLE');
});

test('STARTUP re-adopts by URL or starts the abandon clock', () => {
  let r = reduce(arm().session, { kind: 'STARTUP', at: T0, examTabs: [{ tabId: 9, windowId: 2, url: 'https://e.x/q/1' }] }, cfg);
  assert.equal(r.session.examTabId, 9);
  assert.deepEqual(r.effects, [{ type: 'ABANDON_ALARM_CLEAR' }]);
  r = reduce(arm().session, { kind: 'STARTUP', at: T0, examTabs: [] }, cfg);
  assert.equal(r.session.tabLostAt, T0);
  assert.deepEqual(r.effects, [{ type: 'ABANDON_ALARM_SET', when: T0 + 600000 }]);
});

test('GAP and PERIODIC emit their events', () => {
  assert.deepEqual(reduce(arm().session, { kind: 'GAP', at: T0 + 100000, lastSeenAt: T0, reason: 'sw-restart' }, cfg).events[0].data,
    { lastSeenAt: T0, gapMs: 100000, reason: 'sw-restart' });
  assert.deepEqual(names(reduce(arm().session, { kind: 'PERIODIC', at: T0 }, cfg)), ['PERIODIC']);
});
