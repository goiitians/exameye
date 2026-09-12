import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headerLine, formatLine, chainLine } from '../../src/core/logline.js';

test('headerLine carries id, seat, started, tz and genesis hash', () => {
  const h = headerLine({ id: '20260912-091502_A17', seat: 'A 17', startedAt: Date.UTC(2026, 8, 12, 3, 45, 2, 117) });
  assert.match(h, /^# ExamEye session 20260912-091502_A17 seat="A 17" started=2026-09-12T03:45:02\.117Z tz=[+-]\d\d:\d\d #00000000$/);
});

test('formatLine: ts name tab win data... shot', () => {
  const ev = { seq: 2, ts: '2026-09-12T03:47:10.004Z', t: 0, name: 'TAB_SWITCH', tabId: 42, windowId: 3,
    data: { toUrl: 'https://google.com/', toTitle: 'Go ogle', incognito: false, n: 1.5, x: null }, shot: 'screenshots/a.jpg' };
  assert.equal(formatLine(ev),
    '2026-09-12T03:47:10.004Z TAB_SWITCH tab=42 win=3 toUrl="https://google.com/" toTitle="Go ogle" incognito=false n=1.5 x=null shot="screenshots/a.jpg"');
});

test('formatLine omits absent tab/win/shot and empty data', () => {
  assert.equal(formatLine({ ts: 'T', name: 'PERIODIC', data: {}, shot: null }), 'T PERIODIC');
});

test('chainLine appends the previous hash', () => {
  assert.equal(chainLine('T PERIODIC', 'ba7816bf'), 'T PERIODIC #ba7816bf');
});
