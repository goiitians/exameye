import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsShot, needsDesktopFrame, makeEvent } from '../../src/core/events.js';

test('needsShot follows the catalogue', () => {
  assert.equal(needsShot({ name: 'TAB_SWITCH', data: {} }), true);
  assert.equal(needsShot({ name: 'COPY', data: {} }), true);
  assert.equal(needsShot({ name: 'PERIODIC', data: {} }), true);
  assert.equal(needsShot({ name: 'WINDOW_MINIMIZED', data: {} }), false);
  assert.equal(needsShot({ name: 'IDLE_START', data: {} }), false);
  assert.equal(needsShot({ name: 'PARALLEL_PAGE', data: { trigger: 'activated' } }), true);
  assert.equal(needsShot({ name: 'PARALLEL_PAGE', data: { trigger: 'committed' } }), false);
  assert.equal(needsShot({ name: 'SESSION_DISARMED', data: { outcome: 'RESULT' } }), true);
  assert.equal(needsShot({ name: 'SESSION_DISARMED', data: { outcome: 'ABANDONED' } }), false);
  assert.equal(needsShot({ name: 'SESSION_DISARMED', data: { outcome: 'SUBMITTED' } }), true);
  assert.equal(needsShot({ name: 'SESSION_DISARMED', data: { outcome: 'AUTO_SUBMITTED' } }), true);
  assert.equal(needsShot({ name: 'SESSION_DISARMED', data: { outcome: 'TIMED_OUT' } }), true);
  assert.equal(needsShot({ name: 'START_BUTTON_CLICKED', data: {} }), true);
  assert.equal(needsShot({ name: 'END_BUTTON_CLICKED', data: {} }), true);
  assert.equal(needsShot({ name: 'END_MARKER_SEEN', data: {} }), true);
  assert.equal(needsShot({ name: 'RESULT_PAGE', data: {} }), true);
  assert.equal(needsShot({ name: 'MAX_TIME_REACHED', data: {} }), true);
  assert.equal(needsShot({ name: 'SCREEN_CHANGED', data: {} }), true);
  assert.equal(needsShot({ name: 'DRAG', data: {} }), true);
});

test('needsShot true for the four DESKTOP_CAPTURE_* events, false for DESKTOP_FRAME', () => {
  assert.equal(needsShot({ name: 'DESKTOP_CAPTURE_STARTED', data: {} }), true);
  assert.equal(needsShot({ name: 'DESKTOP_CAPTURE_DECLINED', data: {} }), true);
  assert.equal(needsShot({ name: 'DESKTOP_CAPTURE_STOPPED', data: {} }), true);
  assert.equal(needsShot({ name: 'DESKTOP_CAPTURE_FAILED', data: {} }), true);
  assert.equal(needsShot({ name: 'DESKTOP_FRAME', data: {} }), false);
});

test('needsDesktopFrame true for FOCUS_LEFT_CHROME, FOCUS_RETURNED, PERIODIC, DESKTOP_FRAME; false for TAB_SWITCH and SESSION_ARMED', () => {
  assert.equal(needsDesktopFrame({ name: 'FOCUS_LEFT_CHROME' }), true);
  assert.equal(needsDesktopFrame({ name: 'FOCUS_RETURNED' }), true);
  assert.equal(needsDesktopFrame({ name: 'PERIODIC' }), true);
  assert.equal(needsDesktopFrame({ name: 'DESKTOP_FRAME' }), true);
  assert.equal(needsDesktopFrame({ name: 'TAB_SWITCH' }), false);
  assert.equal(needsDesktopFrame({ name: 'SESSION_ARMED' }), false);
});

test('makeEvent shapes the record and omits absent ids', () => {
  const ev = makeEvent({ seq: 3, at: 1789184702117, name: 'EXAM_NAV', tabId: 41, data: { url: 'u' } });
  assert.deepEqual(ev, { seq: 3, ts: '2026-09-12T03:45:02.117Z', t: 1789184702117, name: 'EXAM_NAV', data: { url: 'u' }, shot: null, tabId: 41 });
  assert.deepEqual(makeEvent({ seq: 1, at: 0, name: 'PERIODIC' }).data, {});
  assert.equal('windowId' in makeEvent({ seq: 1, at: 0, name: 'PERIODIC' }), false);
});
