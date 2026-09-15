import { fmtDuration, fmtLocal, tzOffset } from './ids.js';
import { describeOutcome, describeDesktopSummary } from './summary-text.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

const h = escapeHtml;
const row = (cells) => `<tr>${cells.map(c => `<td>${h(c)}</td>`).join('')}</tr>`;
const table = (head, rows, empty = 'none') => rows.length
  ? `<table>${head ? `<thead><tr>${head.map(x => `<th>${h(x)}</th>`).join('')}</tr></thead>` : ''}<tbody>${rows.join('')}</tbody></table>`
  : `<p class="empty">${h(empty)}</p>`;
const clock = (t) => fmtLocal(t).slice(11);

// status palette (icon + label always accompany the colour)
const OUTCOME = { SUBMITTED: 'good', AUTO_SUBMITTED: 'good', RESULT: 'good', TIMED_OUT: 'warning', ABANDONED: 'critical' };
const FLAGS = [
  ['PARALLEL_PAGE', 'Parallel pages', 'critical'],
  ['TAB_SWITCH', 'Tab switches', 'warning'],
  ['FOCUS_LEFT_CHROME', 'Left Chrome', 'warning'],
  ['INCOGNITO_WINDOW_OPENED', 'Incognito windows', 'critical'],
  ['DEVTOOLS_OPENED', 'DevTools', 'critical'],
  ['COPY', 'Copy', 'serious'],
  ['CUT', 'Cut', 'serious'],
  ['PASTE', 'Paste', 'serious'],
  ['PRINT', 'Print', 'serious'],
  ['DOWNLOAD_STARTED', 'Downloads', 'serious'],
  ['WINDOW_MINIMIZED', 'Window minimised', 'warning'],
  ['FULLSCREEN_EXIT', 'Fullscreen exits', 'warning'],
  ['SCREENSAVER', 'Screensaver / lock', 'warning'],
  ['EXTENSION_GAP', 'Recording gaps', 'serious'],
];
const ICON = { good: '&#10003;', warning: '&#9650;', serious: '&#9679;', critical: '&#10007;' };

const badge = (level, text) => `<span class="badge ${level}">${ICON[level]} ${h(text)}</span>`;
const kpi = (label, value, sub = '') => `<div class="kpi"><div class="k">${h(label)}</div><div class="v">${h(value)}</div>${sub ? `<div class="s">${h(sub)}</div>` : ''}</div>`;

function details(data) {
  const parts = Object.entries(data || {}).filter(([k]) => k !== 'phase' && k !== 'desktopShot' && k !== 'shotError' && k !== 'desktopShotError');
  return parts.map(([k, v]) => `<span class="kv"><b>${h(k)}</b> ${h(typeof v === 'object' ? JSON.stringify(v) : String(v))}</span>`).join(' ');
}

export function renderSummaryHtml({ session, outcome, endedAt, events, tally, integrity, shots, inlineShots }) {
  const desktopFrame = (e) => e.data?.desktopShot ?? (e.name === 'DESKTOP_FRAME' ? e.shot : null);
  const fileIndex = new Map();
  for (const e of events) {
    for (const [f, kind] of [[e.shot, 'tab'], [e.data?.desktopShot, 'desktop']]) {
      if (f && !fileIndex.has(f)) fileIndex.set(f, { kind: e.name === 'DESKTOP_FRAME' ? 'desktop' : kind, event: e.name, t: e.t, phase: e.data?.phase });
    }
  }
  const files = [...fileIndex.keys()];
  const src = (file) => inlineShots ? `data:image/jpeg;base64,${shots[file] || ''}` : file;
  const d = tally.durations;
  const a = tally.attribution;
  const total = Math.max(1, endedAt - session.startedAt);
  const examEnd = session.examEndedAt ?? endedAt;
  const examShots = new Set(events.filter(e => e.shot && e.data?.phase !== 'tail').map(e => e.shot)).size;
  const showTail = session.examEndedAt != null && (tally.tail.events > 0 || session.closingUntil != null);
  const lastFailed = [...events].reverse().find(e => e.name === 'DESKTOP_CAPTURE_FAILED');
  const tabShots = files.filter(f => fileIndex.get(f).kind === 'tab').length;
  const desktopShots = files.length - tabShots;
  const flagged = FLAGS.filter(([n]) => (tally.counts[n] || 0) > 0);

  const bars = [
    ['Tab away', d.tabAwayMs], ['Focus left Chrome (user)', d.focusLeftMs], ['Window minimised', d.minimizedMs],
    ['Screensaver / lock', d.screensaverMs], ['Idle', d.idleMs],
  ].map(([label, ms]) => `<div class="bar"><div class="bl">${h(label)}</div><div class="bt"><div class="bf" style="width:${Math.min(100, (ms / total) * 100).toFixed(2)}%"></div></div><div class="bv">${h(fmtDuration(ms))}</div></div>`).join('');

  const phaseRows = [row(['Exam', `${clock(session.startedAt)} - ${clock(examEnd)}`, fmtDuration(examEnd - session.startedAt), `${examShots} screenshots`])];
  if (showTail) phaseRows.push(row(['Post-submit tail', `${clock(session.examEndedAt)} - ${clock(endedAt)}`, fmtDuration(endedAt - session.examEndedAt), `${tally.tail.shots} screenshots`]));

  const timeline = events.map(e => `<tr class="${e.data?.phase === 'tail' ? 'tail' : ''}"><td class="n">${e.seq}</td><td class="t">${h(clock(e.t))}</td><td class="ev">${h(e.name)}${e.data?.phase === 'tail' ? ' <span class="tag">tail</span>' : ''}</td><td class="d">${details(e.data)}</td><td class="sh">${e.shot ? `<a href="#${h(e.shot)}">tab</a>` : ''}${desktopFrame(e) ? ` <a href="#${h(desktopFrame(e))}">desktop</a>` : ''}</td></tr>`);

  const gallery = files.map(f => {
    const m = fileIndex.get(f);
    return `<figure id="${h(f)}"><a href="#${h(f)}"><img src="${h(src(f))}" alt="${h(f)}"></a><figcaption><span class="tag ${m.kind}">${m.kind}</span> ${h(m.event)} <span class="muted">${h(clock(m.t))}${m.phase === 'tail' ? ' tail' : ''}</span><br><span class="muted">${h(f)}</span></figcaption></figure>`;
  }).join('\n');

  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ExamEye ${h(session.id)}</title>
<style>
:root{--surface:#fcfcfb;--card:#ffffff;--line:#e6e4df;--ink:#0b0b0b;--ink2:#52514e;--muted:#898781;--blue:#2f63c9;--good:#0ca30c;--warning:#fab219;--serious:#ec835a;--critical:#d03b3b}
*{box-sizing:border-box}body{margin:0;background:var(--surface);color:var(--ink);font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{background:#0f2a4a;color:#fff;padding:18px 28px;display:flex;flex-wrap:wrap;gap:16px;align-items:center}header h1{font-size:20px;margin:0;font-weight:600}header .id{font-family:ui-monospace,Menlo,Consolas,monospace;opacity:.85}header .sp{flex:1}
main{padding:20px 28px;max-width:1400px;margin:0 auto}h2{font-size:15px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink2);margin:28px 0 10px}
.badge{display:inline-block;border-radius:999px;padding:3px 10px;font-weight:600;font-size:13px;color:#fff;background:var(--muted)}.badge.good{background:var(--good)}.badge.warning{background:var(--warning);color:var(--ink)}.badge.serious{background:var(--serious);color:var(--ink)}.badge.critical{background:var(--critical)}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}.kpi,.flag{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.kpi .k,.flag .k{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}.kpi .v{font-size:20px;font-weight:600;margin-top:4px}.kpi .s{font-size:12px;color:var(--ink2);margin-top:2px}
.flag{border-left:5px solid var(--good)}.flag.warning{border-left-color:var(--warning)}.flag.serious{border-left-color:var(--serious)}.flag.critical{border-left-color:var(--critical)}.flag .v{font-size:24px;font-weight:700;margin-top:2px}.flag .v small{font-size:12px;font-weight:400;color:var(--ink2);margin-left:6px}
.bars{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.bar{display:grid;grid-template-columns:200px 1fr 80px;align-items:center;gap:12px;padding:5px 0}.bl{color:var(--ink2)}.bt{height:12px;background:#eeede9;border-radius:4px;overflow:hidden}.bf{height:100%;background:var(--blue);border-radius:0 4px 4px 0}.bv{text-align:right;font-variant-numeric:tabular-nums}
table{border-collapse:collapse;width:100%;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}th,td{padding:7px 10px;text-align:left;vertical-align:top;border-top:1px solid var(--line)}th{background:#f4f3ef;color:var(--ink2);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em;border-top:0;position:sticky;top:0}tr:nth-child(even) td{background:#fbfaf8}tr.tail td{background:#f6f8fc}
td.n,td.t{white-space:nowrap;color:var(--muted);font-variant-numeric:tabular-nums}td.ev{white-space:nowrap;font-weight:600}td.d{color:var(--ink2);word-break:break-word}td.sh a{margin-right:6px}.kv{margin-right:10px}.kv b{color:var(--ink);font-weight:500}
.tag{display:inline-block;font-size:11px;padding:1px 7px;border-radius:999px;background:#e8eefb;color:#1d3f7a;vertical-align:middle}.tag.desktop{background:#fdebd9;color:#7a3a10}.tag.tab{background:#e8eefb;color:#1d3f7a}
.muted{color:var(--muted)}.empty{color:var(--muted);margin:6px 0 0}a{color:var(--blue)}
.gallery{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px}figure img{width:100%;height:auto;display:block;border-radius:6px;cursor:zoom-in}figcaption{font-size:12px;margin-top:6px;word-break:break-all}
figure:target{grid-column:1/-1;border-color:var(--blue)}figure:target img{cursor:zoom-out}
@media print{header{background:#0f2a4a!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}th{position:static}.gallery{grid-template-columns:repeat(2,1fr)}figure{break-inside:avoid}}
</style>
<header><h1>ExamEye</h1><span class="id">${h(session.id)}</span><span>Seat ${h(session.seat)}</span><span class="sp"></span>${badge(OUTCOME[outcome] || 'warning', outcome)} ${integrity.ok ? badge('good', `Log chain OK (${integrity.lines} lines)`) : badge('critical', `Log chain BROKEN at line ${integrity.firstBad}`)}</header>
<main>
<div class="grid">
${kpi('Started', fmtLocal(session.startedAt), tzOffset(session.startedAt))}
${kpi('Ended', fmtLocal(endedAt), describeOutcome(session))}
${kpi('Duration', fmtDuration(endedAt - session.startedAt), showTail ? `exam ${fmtDuration(examEnd - session.startedAt)} + tail ${fmtDuration(endedAt - session.examEndedAt)}` : '')}
${kpi('Screenshots', `${tabShots} tab / ${desktopShots} desktop`, `${files.length} files`)}
${kpi('Desktop capture', describeDesktopSummary(tally.desktop, endedAt, lastFailed?.data?.error))}
${kpi('Events', String(events.length), `${Object.keys(tally.counts).length} kinds`)}
</div>
<h2>Flags</h2>
<div class="grid">
${flagged.length ? flagged.map(([n, label, level]) => `<div class="flag ${level}"><div class="k">${h(label)}</div><div class="v">${tally.counts[n]}<small>${ICON[level]} ${h(level)}</small></div></div>`).join('') : '<div class="flag"><div class="k">No flags</div><div class="v">&#10003;<small>nothing to review</small></div></div>'}
</div>
<h2>Time away</h2>
<div class="bars">${bars}<div class="muted" style="margin-top:6px">Focus-left episodes attributed to: user ${a.user}, screensaver ${a.screensaver}, idle ${a.idle} (only user time is counted above)</div></div>
<h2>Phases</h2>
${table(['Phase', 'Span', 'Duration', 'Screenshots'], phaseRows)}
<h2>Parallel pages</h2>
${table(['Focused', 'Visits', 'URL', 'Title', 'Incognito'], tally.parallel.map(p => row([fmtDuration(p.focusedMs), p.visits, p.url, p.title, p.incognito ? 'yes' : 'no'])), 'No parallel pages')}
<h2>Desktop capture</h2>
<p>${h(describeDesktopSummary(tally.desktop, endedAt, lastFailed?.data?.error))}</p>
${table(['Time', 'Event', 'Details'], events.filter(e => e.name.startsWith('DESKTOP_CAPTURE_')).map(e => `<tr><td class="t">${h(clock(e.t))}</td><td class="ev">${h(e.name)}</td><td class="d">${details(e.data)}</td></tr>`), 'No desktop capture events')}
<h2>Counts</h2>
${table(['Event', 'Count'], Object.keys(tally.counts).sort().map(n => row([n, tally.counts[n]])))}
<h2>Timeline</h2>
${table(['#', 'Time', 'Event', 'Details', 'Shots'], timeline)}
<h2>Screenshots (${files.length})</h2>
<div class="gallery">
${gallery}
</div>
</main>
`;
}
