import { fmtDuration, fmtLocal, tzOffset } from './ids.js';

const dots = (label, width) => (label + ' ').padEnd(width, '.');

export function describeOutcome(session) {
  const { trigger, triggerLabel, examEndedAt, maxAt, startedAt } = session;
  const at = examEndedAt != null ? fmtLocal(examEndedAt).slice(11) : null;
  let line;
  if (trigger === 'button') line = `end button "${triggerLabel}" clicked at ${at}`;
  else if (trigger === 'marker') line = `end marker "${triggerLabel}" seen at ${at}`;
  else if (trigger === 'result') line = `result URL ${triggerLabel} reached at ${at}`;
  else if (trigger === 'max') line = `maximum time (${Math.round((maxAt - startedAt) / 60000)} min) reached at ${at}`;
  else line = 'exam tab closed and not reopened';
  if (maxAt) line += `   (auto-submit expected at ${fmtLocal(maxAt).slice(11)})`;
  return line;
}

export function renderSummaryText({ session, outcome, endedAt, events, tally, integrity }) {
  const shots = new Set(events.filter(e => e.shot).map(e => e.shot)).size;
  const d = tally.durations;
  const a = tally.attribution;
  const examEnd = session.examEndedAt ?? endedAt;
  const examShots = new Set(events.filter(e => e.shot && e.data?.phase !== 'tail').map(e => e.shot)).size;
  const showTail = session.examEndedAt != null && (tally.tail.events > 0 || session.closingUntil != null);
  const L = [
    'ExamEye summary',
    `Session:   ${session.id}   Seat: ${session.seat}`,
    `Started:   ${fmtLocal(session.startedAt)} (${tzOffset(session.startedAt)})   Ended: ${fmtLocal(endedAt)}   Outcome: ${outcome}`,
    `Trigger:   ${describeOutcome(session)}`,
    `Duration:  ${fmtDuration(endedAt - session.startedAt)}`,
    `Log chain: ${integrity.ok ? 'OK' : `BROKEN at line ${integrity.firstBad}`} (${integrity.lines} lines)`,
    '', 'Phases',
    `  ${dots('Exam', 18)} ${fmtLocal(session.startedAt).slice(11)} - ${fmtLocal(examEnd).slice(11)}  ${examShots} screenshots`,
  ];
  if (showTail) L.push(`  ${dots('Post-submit tail', 18)} ${fmtLocal(session.examEndedAt).slice(11)} - ${fmtLocal(endedAt).slice(11)}  ${tally.tail.shots} screenshots`);
  L.push('', 'Counts');
  for (const n of Object.keys(tally.counts).sort()) L.push(`  ${dots(n, 24)} ${tally.counts[n]}`);
  L.push('', 'Time away',
    `  ${dots('Tab away', 18)} ${fmtDuration(d.tabAwayMs)}`,
    `  ${dots('Focus left', 18)} ${fmtDuration(d.focusLeftMs)}   (user; screensaver: ${a.screensaver}, idle: ${a.idle} not counted)`,
    `  ${dots('Minimized', 18)} ${fmtDuration(d.minimizedMs)}`,
    `  ${dots('Screensaver/lock', 18)} ${fmtDuration(d.screensaverMs)}`,
    `  ${dots('Idle', 18)} ${fmtDuration(d.idleMs)}`,
    '', 'Parallel pages (focused time, visits)');
  for (const p of tally.parallel) L.push(`  ${fmtDuration(p.focusedMs)}  ${p.visits}  ${p.url}  ${JSON.stringify(p.title)}${p.incognito ? '  [incognito]' : ''}`);
  L.push('', `Screenshots: ${shots} (screenshots/)`, '');
  return L.join('\n');
}
