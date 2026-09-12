import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSummaryText } from '../../src/core/summary-text.js';
import { tally } from '../../src/core/counters.js';

const started = new Date(2026, 8, 12, 9, 15, 2).getTime();
const events = [
  { seq: 1, t: started, name: 'SESSION_ARMED', data: {}, shot: 'screenshots/a.jpg' },
  { seq: 2, t: started + 1000, name: 'PARALLEL_PAGE', data: { url: 'https://g.x/', title: 'G', trigger: 'activated', incognito: true }, shot: 'screenshots/a.jpg', tabId: 2 },
  { seq: 3, t: started + 4000, name: 'TAB_RETURN', data: { awayMs: 3000 }, shot: null },
];
const ctx = { session: { id: '20260912-091502_A17', seat: 'A17', startedAt: started }, outcome: 'RESULT', endedAt: started + 3723000, events, tally: tally(events), integrity: { ok: true, firstBad: -1, lines: 4 } };

test('summary.txt layout', () => {
  const txt = renderSummaryText(ctx);
  const lines = txt.split('\n');
  assert.equal(lines[0], 'ExamEye summary');
  assert.equal(lines[1], 'Session:   20260912-091502_A17   Seat: A17');
  assert.match(lines[2], /^Started:   2026-09-12 09:15:02 \([+-]\d\d:\d\d\)   Ended: 2026-09-12 10:17:05   Outcome: RESULT$/);
  assert.equal(lines[3], 'Duration:  01:02:03');
  assert.equal(lines[4], 'Log chain: OK (4 lines)');
  assert.ok(lines.includes('  PARALLEL_PAGE .......... 1'));
  assert.ok(lines.includes('  Tab away ......... 00:00:03'));
  assert.ok(lines.includes('  00:00:03  1  https://g.x/  "G"  [incognito]'));
  assert.ok(lines.includes('Screenshots: 1 (screenshots/)'));
  assert.ok(txt.endsWith('\n'));
});

test('broken chain is reported', () => {
  assert.match(renderSummaryText({ ...ctx, integrity: { ok: false, firstBad: 2, lines: 4 } }), /Log chain: BROKEN at line 2 \(4 lines\)/);
});

test('time away block: screensaver/lock row and focus-left annotation (addendum A, spec §8)', () => {
  const evs = [
    { seq: 1, t: started, name: 'FOCUS_LEFT_CHROME', data: {} },
    { seq: 2, t: started + 800, name: 'IDLE_START', data: { state: 'locked' } },
    { seq: 3, t: started + 2500, name: 'IDLE_END', data: { idleMs: 4000 } },
    { seq: 4, t: started + 3000, name: 'FOCUS_RETURNED', data: { awayMs: 2000 } },
  ];
  const ctx2 = { session: { id: 'X', seat: 'A1', startedAt: started }, outcome: 'RESULT', endedAt: started + 5000, events: evs, tally: tally(evs), integrity: { ok: true, firstBad: -1, lines: 2 } };
  const lines = renderSummaryText(ctx2).split('\n');
  assert.ok(lines.includes('  Focus left ....... 00:00:00   (user; screensaver: 1, idle: 0 not counted)'));
  assert.ok(lines.includes('  Screensaver/lock . 00:00:04'));
  assert.ok(lines.includes('  SCREENSAVER ............ 1'));
});
