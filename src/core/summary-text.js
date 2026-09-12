import { fmtDuration, fmtLocal, tzOffset } from './ids.js';

const dots = (label, width) => (label + ' ').padEnd(width, '.');

export function renderSummaryText({ session, outcome, endedAt, events, tally, integrity }) {
  const shots = new Set(events.filter(e => e.shot).map(e => e.shot)).size;
  const d = tally.durations;
  const a = tally.attribution;
  const L = [
    'ExamEye summary',
    `Session:   ${session.id}   Seat: ${session.seat}`,
    `Started:   ${fmtLocal(session.startedAt)} (${tzOffset(session.startedAt)})   Ended: ${fmtLocal(endedAt)}   Outcome: ${outcome}`,
    `Duration:  ${fmtDuration(endedAt - session.startedAt)}`,
    `Log chain: ${integrity.ok ? 'OK' : `BROKEN at line ${integrity.firstBad}`} (${integrity.lines} lines)`,
    '', 'Counts',
  ];
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
