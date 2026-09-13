import { fmtDuration, fmtLocal, tzOffset } from './ids.js';
import { describeOutcome } from './summary-text.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

const row = (cells) => `<tr>${cells.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`;
const table = (head, rows) => `<table>${head ? `<tr>${head.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr>` : ''}${rows.join('')}</table>`;

export function renderSummaryHtml({ session, outcome, endedAt, events, tally, integrity, shots, inlineShots }) {
  const files = [...new Set(events.filter(e => e.shot).map(e => e.shot))];
  const src = (file) => inlineShots ? `data:image/jpeg;base64,${shots[file] || ''}` : file;
  const d = tally.durations;
  const a = tally.attribution;
  const examEnd = session.examEndedAt ?? endedAt;
  const examShots = new Set(events.filter(e => e.shot && e.data?.phase !== 'tail').map(e => e.shot)).size;
  const showTail = session.examEndedAt != null && (tally.tail.events > 0 || session.closingUntil != null);
  const phaseRows = [row(['Exam', `${fmtLocal(session.startedAt).slice(11)} - ${fmtLocal(examEnd).slice(11)}`, `${examShots} screenshots`])];
  if (showTail) phaseRows.push(row(['Post-submit tail', `${fmtLocal(session.examEndedAt).slice(11)} - ${fmtLocal(endedAt).slice(11)}`, `${tally.tail.shots} screenshots`]));
  return `<!doctype html>
<meta charset="utf-8">
<title>ExamEye ${escapeHtml(session.id)}</title>
<style>body{font:14px system-ui;margin:24px}table{border-collapse:collapse;margin:8px 0 20px}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left;vertical-align:top}img{max-width:480px;display:block;margin:4px 0 16px}</style>
<h1>ExamEye summary - ${escapeHtml(session.id)}</h1>
${table(null, [row(['Seat', session.seat]), row(['Started', `${fmtLocal(session.startedAt)} (${tzOffset(session.startedAt)})`]), row(['Ended', fmtLocal(endedAt)]), row(['Outcome', outcome]), row(['Trigger', describeOutcome(session)]), row(['Duration', fmtDuration(endedAt - session.startedAt)]), row(['Log chain', integrity.ok ? `OK (${integrity.lines} lines)` : `BROKEN at line ${integrity.firstBad} (${integrity.lines} lines)`])])}
<h2>Phases</h2>
${table(['Phase', 'Span', 'Screenshots'], phaseRows)}
<h2>Counts</h2>
${table(['Event', 'Count'], Object.keys(tally.counts).sort().map(n => row([n, tally.counts[n]])))}
<h2>Time away</h2>
${table(null, [
    row(['Tab away', fmtDuration(d.tabAwayMs)]),
    row(['Focus left', `${fmtDuration(d.focusLeftMs)} (user; screensaver: ${a.screensaver}, idle: ${a.idle} not counted)`]),
    row(['Minimized', fmtDuration(d.minimizedMs)]),
    row(['Screensaver/lock', fmtDuration(d.screensaverMs)]),
    row(['Idle', fmtDuration(d.idleMs)]),
  ])}
<h2>Parallel pages</h2>
${table(['Focused', 'Visits', 'URL', 'Title', 'Incognito'], tally.parallel.map(p => row([fmtDuration(p.focusedMs), p.visits, p.url, p.title, p.incognito ? 'yes' : 'no'])))}
<h2>Timeline</h2>
${table(['#', 'Time', 'Event', 'Details', 'Shot'], events.map(e => `<tr><td>${e.seq}</td><td>${escapeHtml(fmtLocal(e.t))}</td><td>${escapeHtml(e.name)}</td><td>${escapeHtml(JSON.stringify(e.data))}</td><td>${e.shot ? `<a href="#${escapeHtml(e.shot)}">view</a>` : ''}</td></tr>`))}
<h2>Screenshots (${files.length})</h2>
${files.map(f => `<h3 id="${escapeHtml(f)}">${escapeHtml(f)}</h3><img src="${escapeHtml(src(f))}" alt="${escapeHtml(f)}">`).join('\n')}
`;
}
