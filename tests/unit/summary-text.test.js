import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSummaryText, describeOutcome, describeDesktopSummary } from '../../src/core/summary-text.js';
import { tally } from '../../src/core/counters.js';
import { fmtLocal } from '../../src/core/ids.js';

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
  assert.equal(lines[4], 'Duration:  01:02:03');
  assert.equal(lines[5], 'Log chain: OK (4 lines)');
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

test('describeOutcome names the trigger', () => {
  const t1 = started + 61000;
  assert.equal(describeOutcome({ startedAt: started, maxAt: null, trigger: 'button', triggerLabel: 'Submit', examEndedAt: t1 }),
    `end button "Submit" clicked at ${fmtLocal(t1).slice(11)}`);
  assert.equal(describeOutcome({ startedAt: started, maxAt: null, trigger: 'marker', triggerLabel: 'answers submitted', examEndedAt: t1 }),
    `end marker "answers submitted" seen at ${fmtLocal(t1).slice(11)}`);
  assert.equal(describeOutcome({ startedAt: started, maxAt: null, trigger: 'result', triggerLabel: 'https://e.x/result/9', examEndedAt: t1 }),
    `result URL https://e.x/result/9 reached at ${fmtLocal(t1).slice(11)}`);
  const maxAt = started + 180 * 60000;
  assert.equal(describeOutcome({ startedAt: started, maxAt, trigger: 'max', triggerLabel: null, examEndedAt: maxAt }),
    `maximum time (180 min) reached at ${fmtLocal(maxAt).slice(11)}   (auto-submit expected at ${fmtLocal(maxAt).slice(11)})`);
  assert.equal(describeOutcome({ startedAt: started, maxAt: null, trigger: 'abandon', triggerLabel: null, examEndedAt: null }),
    'exam tab closed and not reopened');
});

test('Trigger and Phases lines', () => {
  const examEndedAt = started + 3300000;
  const maxAt = started + 3600000;
  const evs = [{ seq: 1, t: started, name: 'SESSION_ARMED', data: {}, shot: 'screenshots/a.jpg' }];
  const session = { id: 'X', seat: 'A1', startedAt: started, trigger: 'button', triggerLabel: 'submit', examEndedAt, maxAt, closingUntil: examEndedAt + 300000 };
  const ctx3 = { session, outcome: 'SUBMITTED', endedAt: examEndedAt + 300000, events: evs, tally: tally(evs), integrity: { ok: true, firstBad: -1, lines: 2 } };
  const lines = renderSummaryText(ctx3).split('\n');
  assert.match(lines[3], /^Trigger:   end button "submit" clicked at \d\d:\d\d:\d\d   \(auto-submit expected at \d\d:\d\d:\d\d\)$/);
  const phasesAt = lines.indexOf('Phases');
  assert.ok(phasesAt !== -1);
  assert.match(lines[phasesAt + 1], /^  Exam .+ \d\d:\d\d:\d\d - \d\d:\d\d:\d\d  1 screenshots$/);
  assert.match(lines[phasesAt + 2], /^  Post-submit tail .+ \d\d:\d\d:\d\d - \d\d:\d\d:\d\d  0 screenshots$/);

  const legacySession = { id: 'Y', seat: 'A1', startedAt: started, trigger: null, triggerLabel: null, examEndedAt: null, maxAt: null, closingUntil: null };
  const ctx4 = { session: legacySession, outcome: 'ABANDONED', endedAt: started + 60000, events: evs, tally: tally(evs), integrity: { ok: true, firstBad: -1, lines: 2 } };
  const lines2 = renderSummaryText(ctx4).split('\n');
  assert.equal(lines2[3], 'Trigger:   exam tab closed and not reopened');
  const phasesAt2 = lines2.indexOf('Phases');
  assert.match(lines2[phasesAt2 + 1], /^  Exam /);
  assert.equal(lines2[phasesAt2 + 2], '');
});

test('describeDesktopSummary', () => {
  assert.equal(describeDesktopSummary({ frames: 0, asks: 0, declined: 0, failed: 0, spans: [] }), 'off');
  assert.equal(describeDesktopSummary({ asks: 3, declined: 3, spans: [] }), 'declined (3 asks)');
  assert.equal(describeDesktopSummary({ failed: 1, spans: [] }, undefined, 'NotAllowedError'), 'failed: NotAllowedError');

  const onAt = new Date(2026, 8, 12, 9, 15, 4).getTime();
  const endedAt = new Date(2026, 8, 12, 12, 15, 44).getTime();
  assert.equal(
    describeDesktopSummary({ frames: 37, declined: 0, spans: [{ from: onAt, to: null, stopped: false }] }, endedAt),
    'on 09:15:04 - 12:15:44 (37 frames)',
  );

  const stopAt = new Date(2026, 8, 12, 9, 40, 2).getTime();
  const resumeAt = new Date(2026, 8, 12, 9, 41, 30).getTime();
  assert.equal(
    describeDesktopSummary({
      frames: 37, declined: 1,
      spans: [{ from: onAt, to: stopAt, stopped: true }, { from: resumeAt, to: null, stopped: false }],
    }, endedAt),
    'on 09:15:04 - 09:40:02, stopped at 09:40:02, re-shared 09:41:30 - 12:15:44 (37 frames); declined 1x',
  );

  assert.equal(
    describeDesktopSummary({ frames: 3, declined: 0, screens: 2, spans: [{ from: onAt, to: null, stopped: false }] }, endedAt),
    'on 09:15:04 - 12:15:44 (3 frames) (2+ screens; only the shared one is captured)',
  );
  assert.equal(
    describeDesktopSummary({ frames: 3, declined: 0, screens: 1, spans: [{ from: onAt, to: null, stopped: false }] }, endedAt),
    'on 09:15:04 - 12:15:44 (3 frames)',
  );
});

test('summary.txt has the Desktop line after Log chain and a Desktop frames line when frames > 0', () => {
  const evs = [{ seq: 1, t: started, name: 'SESSION_ARMED', data: {}, shot: 'screenshots/a.jpg' }];
  const t = tally(evs);
  t.desktop = { frames: 37, asks: 1, declined: 0, failed: 0, spans: [{ from: started + 2000, to: null, stopped: false }] };
  const ctx5 = { session: { id: 'X', seat: 'A1', startedAt: started }, outcome: 'RESULT', endedAt: started + 3723000, events: evs, tally: t, integrity: { ok: true, firstBad: -1, lines: 2 } };
  const text = renderSummaryText(ctx5);
  assert.match(text, /^Desktop:   on /m);
  assert.match(text, /^Desktop frames: 37 \(screenshots\/desktop\/\)$/m);

  t.desktop = { ...t.desktop, frames: 0 };
  const noFramesText = renderSummaryText(ctx5);
  assert.doesNotMatch(noFramesText, /^Desktop frames:/m);
});
