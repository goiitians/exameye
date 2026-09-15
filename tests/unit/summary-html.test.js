import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, renderSummaryHtml } from '../../src/core/summary-html.js';
import { tally } from '../../src/core/counters.js';

const started = new Date(2026, 8, 12, 9, 15, 2).getTime();
const events = [
  { seq: 1, t: started, name: 'SESSION_ARMED', data: { url: 'https://e.x/start?a=1&b=<x>' }, shot: 'screenshots/s1.jpg' },
  { seq: 2, t: started + 1000, name: 'PARALLEL_PAGE', data: { url: 'https://g.x/', title: '<b>G</b>', trigger: 'activated', incognito: false }, shot: 'screenshots/s1.jpg', tabId: 2 },
];
const ctx = { session: { id: 'S1', seat: 'A17', startedAt: started }, outcome: 'RESULT', endedAt: started + 60000, events, tally: tally(events), integrity: { ok: true, firstBad: -1, lines: 3 }, shots: { 'screenshots/s1.jpg': '/9j/AAA' } };

test('escapeHtml', () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});

test('inline variant embeds data URIs, escapes user text, has no scripts', () => {
  const html = renderSummaryHtml({ ...ctx, inlineShots: true });
  assert.ok(html.includes('<img src="data:image/jpeg;base64,/9j/AAA"'));
  assert.ok(html.includes('&lt;b&gt;G&lt;/b&gt;'));
  assert.ok(!html.includes('<b>G</b>'));
  assert.ok(!/<script/i.test(html));
  assert.ok(html.includes('Screenshots (1)'));
  assert.ok(html.includes('<td>SESSION_ARMED</td>'));
});

test('linked variant references files relative to the session folder', () => {
  const html = renderSummaryHtml({ ...ctx, inlineShots: false });
  assert.ok(html.includes('<img src="screenshots/s1.jpg"'));
  assert.ok(!html.includes('data:image/jpeg'));
});

test('includes Trigger row and Phases table', () => {
  const session = { ...ctx.session, trigger: 'button', triggerLabel: 'finish', examEndedAt: started + 30000, maxAt: null, closingUntil: started + 90000 };
  const html = renderSummaryHtml({ ...ctx, session, inlineShots: true });
  assert.ok(html.includes('end button &quot;finish&quot; clicked at'));
  assert.ok(html.includes('Post-submit tail'));
});

test('Desktop capture section lists DESKTOP_* events and the status line', () => {
  const evs = [...events, { seq: 3, t: started + 2000, name: 'DESKTOP_CAPTURE_STARTED', data: { width: 1920, height: 1080, pickMs: 300 }, shot: null }];
  const html = renderSummaryHtml({ ...ctx, events: evs, tally: tally(evs), inlineShots: true });
  assert.ok(html.includes('<h2>Desktop capture</h2>'));
  assert.ok(html.includes('<td>DESKTOP_CAPTURE_STARTED</td>'));
});

test('timeline row links the desktop frame and the screenshots section includes desktop files', () => {
  const evs = [...events, { seq: 3, t: started + 2000, name: 'FOCUS_LEFT_CHROME', data: { desktopShot: 'screenshots/desktop/x.jpg' }, shot: null }];
  const shots = { ...ctx.shots, 'screenshots/desktop/x.jpg': '/9j/BBB' };
  const htmlInline = renderSummaryHtml({ ...ctx, events: evs, tally: tally(evs), shots, inlineShots: true });
  const id = htmlInline.match(/<figure id="(s\d+)"[^>]*>(?:(?!<\/figure>).)*screenshots\/desktop\/x\.jpg/s)[1];
  assert.ok(htmlInline.includes(`<a href="#${id}">desktop</a>`), 'the timeline desktop link must target that file\'s figure');
  assert.ok(htmlInline.includes('<span class="tag desktop">desktop</span>'));
  assert.ok(htmlInline.includes('<img src="data:image/jpeg;base64,/9j/BBB"'));

  const htmlLinked = renderSummaryHtml({ ...ctx, events: evs, tally: tally(evs), shots, inlineShots: false });
  assert.ok(htmlLinked.includes('src="screenshots/desktop/x.jpg"'));
});

test('dashboard: outcome and log-chain badges carry icon + label, flags appear only for non-zero risky counts', () => {
  const html = renderSummaryHtml({ ...ctx, inlineShots: true });
  assert.match(html, /<span class="badge good">&#10003; RESULT<\/span>/);
  assert.match(html, /<span class="badge good">&#10003; Log chain OK \(3 lines\)<\/span>/);
  assert.match(html, /<div class="flag critical"><div class="k">Parallel pages<\/div><div class="v">1<small>/);
  assert.ok(!html.includes('Tab switches'), 'a zero count must not render a flag tile');
  const broken = renderSummaryHtml({ ...ctx, integrity: { ok: false, firstBad: 2, lines: 3 }, outcome: 'ABANDONED', inlineShots: true });
  assert.match(broken, /badge critical">&#10007; Log chain BROKEN at line 2/);
  assert.match(broken, /badge critical">&#10007; ABANDONED/);
});

test('dashboard: time-away bars are proportional to the session and details render as key/value, not JSON', () => {
  const evs = [
    ...events,
    { seq: 3, t: started + 2000, name: 'FOCUS_LEFT_CHROME', data: {}, shot: null },
    { seq: 4, t: started + 32000, name: 'FOCUS_RETURNED', data: { awayMs: 30000 }, shot: null },
  ];
  const html = renderSummaryHtml({ ...ctx, events: evs, tally: tally(evs), inlineShots: true });
  assert.match(html, /Focus left Chrome \(user\)<\/div><div class="bt"><div class="bf" style="width:50\.00%"><\/div><\/div><div class="bv">00:00:30/);
  assert.ok(html.includes('<span class="kv"><b>awayMs</b> 30000</span>'));
  assert.ok(!html.includes('{&quot;awayMs&quot;'), 'timeline details must not be a JSON dump');
  assert.match(html, /<td class="ev">FOCUS_LEFT_CHROME<\/td>/);
});

test('dashboard: tail-phase rows are tagged and no image is duplicated between timeline and gallery', () => {
  const evs = [...events, { seq: 3, t: started + 2000, name: 'DESKTOP_FRAME', data: { n: 1, phase: 'tail' }, shot: 'screenshots/desktop/f.jpg' }];
  const shots = { ...ctx.shots, 'screenshots/desktop/f.jpg': '/9j/CCC' };
  const html = renderSummaryHtml({ ...ctx, events: evs, tally: tally(evs), shots, inlineShots: true });
  assert.match(html, /<tr class="tail">.*DESKTOP_FRAME <span class="tag">tail<\/span>/);
  assert.equal(html.split('/9j/CCC').length - 1, 1);
  assert.equal(html.split('/9j/AAA').length - 1, 1);
});

test('lightbox: every figure carries close, prev/next through the set and a counter; no scripts, no duplicated images', () => {
  const evs = [
    ...events,
    { seq: 3, t: started + 2000, name: 'FOCUS_LEFT_CHROME', data: { desktopShot: 'screenshots/desktop/x.jpg' }, shot: 'screenshots/s3.jpg' },
    { seq: 4, t: started + 3000, name: 'PERIODIC', data: {}, shot: 'screenshots/s4.jpg' },
  ];
  const shots = { ...ctx.shots, 'screenshots/desktop/x.jpg': '/9j/BBB', 'screenshots/s3.jpg': '/9j/CCC', 'screenshots/s4.jpg': '/9j/DDD' };
  const html = renderSummaryHtml({ ...ctx, events: evs, tally: tally(evs), shots, inlineShots: true });
  const figures = [...html.matchAll(/<figure id="(s\d+)"/g)].map(m => m[1]);
  assert.deepEqual(figures, ['s1', 's2', 's3', 's4']);
  for (const [i, id] of figures.entries()) {
    const fig = html.slice(html.indexOf(`<figure id="${id}"`), html.indexOf('</figure>', html.indexOf(`<figure id="${id}"`)));
    assert.ok(fig.includes('href="#_"'), `${id} close`);
    assert.ok(fig.includes(`${i + 1} / 4`), `${id} counter`);
    if (i > 0) assert.ok(fig.includes(`href="#${figures[i - 1]}"`), `${id} prev`); else assert.ok(!/class="prev"/.test(fig));
    if (i < 3) assert.ok(fig.includes(`href="#${figures[i + 1]}"`), `${id} next`); else assert.ok(!/class="next"/.test(fig));
  }
  assert.ok(html.includes('figure:target{position:fixed'));
  assert.ok(html.includes('body:has(figure:target){overflow:hidden}'));
  assert.ok(!/<script/i.test(html));
  for (const b64 of Object.values(shots)) assert.equal(html.split(b64).length - 1, 1, 'each image embedded exactly once');
});
