import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsShot, makeEvent } from '../../src/core/events.js';

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
});

test('makeEvent shapes the record and omits absent ids', () => {
  const ev = makeEvent({ seq: 3, at: 1789184702117, name: 'EXAM_NAV', tabId: 41, data: { url: 'u' } });
  assert.deepEqual(ev, { seq: 3, ts: '2026-09-12T03:45:02.117Z', t: 1789184702117, name: 'EXAM_NAV', data: { url: 'u' }, shot: null, tabId: 41 });
  assert.deepEqual(makeEvent({ seq: 1, at: 0, name: 'PERIODIC' }).data, {});
  assert.equal('windowId' in makeEvent({ seq: 1, at: 0, name: 'PERIODIC' }), false);
});
