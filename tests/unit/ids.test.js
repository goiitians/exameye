import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stamp, tzOffset, fmtLocal, fmtDuration, sanitizeSeat, sessionId, shotFile } from '../../src/core/ids.js';

const d = new Date(2026, 8, 12, 9, 15, 2);

test('stamp and fmtLocal use local time', () => {
  assert.equal(stamp(d), '20260912-091502');
  assert.equal(fmtLocal(d.getTime()), '2026-09-12 09:15:02');
});

test('tzOffset is signed HH:MM', () => {
  assert.match(tzOffset(d), /^[+-]\d\d:\d\d$/);
});

test('fmtDuration', () => {
  assert.equal(fmtDuration(0), '00:00:00');
  assert.equal(fmtDuration(3723000), '01:02:03');
  assert.equal(fmtDuration(-5), '00:00:00');
});

test('seat is sanitised for file names, raw form untouched elsewhere', () => {
  assert.equal(sanitizeSeat('A 17/B'), 'A_17_B');
  assert.equal(sanitizeSeat(''), 'SEAT');
  assert.equal(sanitizeSeat('x'.repeat(40)).length, 32);
});

test('sessionId and shotFile', () => {
  assert.equal(sessionId(d, 'A17'), '20260912-091502_A17');
  assert.equal(shotFile(d, 'TAB_SWITCH'), 'screenshots/20260912-091502_TAB_SWITCH.jpg');
});
