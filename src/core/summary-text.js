import { fmtDuration, fmtLocal, tzOffset } from './ids.js';
import { describeShotError } from './events.js';

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

export function describeDesktopSummary(desktop, endedAt, lastError) {
  const { frames = 0, asks = 0, declined = 0, failed = 0, screens = 1, spans = [] } = desktop;
  if (spans.length === 0) {
    if (failed > 0) return `failed: ${lastError}`;
    if (declined > 0) return `declined (${asks} asks)`;
    return 'off';
  }
  let line = '';
  spans.forEach((sp, i) => {
    const from = fmtLocal(sp.from).slice(11);
    const to = fmtLocal(sp.to ?? endedAt).slice(11);
    line += i === 0 ? `on ${from} - ${to}` : `, re-shared ${from} - ${to}`;
    if (sp.stopped) line += `, stopped at ${to}`;
  });
  line += ` (${frames} frames)`;
  if (screens > 1) line += ` (${screens}+ screens; only the shared one is captured)`;
  if (declined > 0) line += `; declined ${declined}x`;
  return line;
}

export function renderSummaryText({ session, outcome, endedAt, events, tally, integrity }) {
  const shots = new Set(events.filter(e => e.shot).map(e => e.shot)).size;
  const d = tally.durations;
  const a = tally.attribution;
  const examEnd = session.examEndedAt ?? endedAt;
  const examShots = new Set(events.filter(e => e.shot && e.data?.phase !== 'tail').map(e => e.shot)).size;
  const showTail = session.examEndedAt != null && (tally.tail.events > 0 || session.closingUntil != null);
  const lastFailed = [...events].reverse().find(e => e.name === 'DESKTOP_CAPTURE_FAILED');
  const L = [
    'ExamEye summary',
    `Session:   ${session.id}   Seat: ${session.seat}`,
    `Started:   ${fmtLocal(session.startedAt)} (${tzOffset(session.startedAt)})   Ended: ${fmtLocal(endedAt)}   Outcome: ${outcome}`,
    `Trigger:   ${describeOutcome(session)}`,
    `Duration:  ${fmtDuration(endedAt - session.startedAt)}`,
    `Log chain: ${integrity.ok ? 'OK' : `BROKEN at line ${integrity.firstBad}`} (${integrity.lines} lines)`,
    `Desktop:   ${describeDesktopSummary(tally.desktop, endedAt, lastFailed?.data?.error)}`,
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
  L.push('', `Screenshots: ${shots} (screenshots/)`);
  const missed = events.filter(e => e.data?.shotError);
  if (missed.length) {
    L.push(`Not captured: ${missed.length}`);
    for (const e of missed) L.push('  ' + [fmtLocal(e.t).slice(11), e.name, e.data.toUrl ?? e.data.url, describeShotError(e.data.shotError)].filter(Boolean).join('  '));
  }
  if (tally.desktop.frames > 0) L.push(`Desktop frames: ${tally.desktop.frames} (screenshots/desktop/)`);
  L.push('');
  return L.join('\n');
}
