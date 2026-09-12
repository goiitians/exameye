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
