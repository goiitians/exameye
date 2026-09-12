import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startSite, launch, storage, waitFor } from './harness.js';

const decodeDataUrl = (url) => {
  const m = /^data:[^;]+;base64,(.*)$/s.exec(url || '');
  return m ? Buffer.from(m[1], 'base64').toString('utf8') : null;
};

test('arm on start page, record a tab switch, disarm on result, files written', async () => {
  const site = await startSite();
  const config = { startPrefix: `${site.origin}/exam/start.html`, examPrefix: '', resultPrefix: `${site.origin}/exam/result.html`, seat: 'T1', subfolder: 'ExamEyeTest', shotIntervalMin: 10, abandonMin: 10 };
  const b = await launch(config);
  try {
    // chrome.downloads.search() reliably returns [] under Playwright's CDP
    // Browser.setDownloadBehavior override (confirmed in task-22-report.md fix-round-1, even
    // immediately after a single manual download() call), so per-file content can't be read
    // back after the fact. chrome.downloads.onCreated/onChanged do carry full data (url,
    // filename, state) live on the same items, so an extension page (not the exam site, so it
    // can't be mistaken for an exam/result page) is opened up front to collect them for the
    // whole run.
    const extId = new URL(b.worker.url()).host;
    const collector = await b.context.newPage();
    await collector.goto(`chrome-extension://${extId}/src/options/options.html`);
    await collector.evaluate(() => {
      window.__dl = [];
      window.__dlc = [];
      chrome.downloads.onCreated.addListener((i) => window.__dl.push(i));
      chrome.downloads.onChanged.addListener((d) => window.__dlc.push(d));
    });
    await b.page.bringToFront();

    await b.page.goto(`${site.origin}/exam/start.html?c=1`);
    await waitFor(async () => (await storage(b.worker, 'session')).session?.state === 'ARMED');
    const { session: armed } = await storage(b.worker, 'session');
    // SESSION_ARMED already took a screenshot; sw.js coalesces any further shot within
    // SHOT_GAP_MS (2000ms) onto that same file, so wait it out to get a distinct TAB_SWITCH shot.
    await new Promise(r => setTimeout(r, 2100));
    const other = await b.context.newPage();
    await other.goto(`${site.origin}/other.html`);
    await other.bringToFront();
    await waitFor(async () => ((await storage(b.worker, 'events')).events || []).some(e => e.name === 'TAB_SWITCH'));
    await b.page.bringToFront();
    await b.page.evaluate(() => document.execCommand('copy'));
    await b.page.goto(`${site.origin}/exam/result.html`);
    await waitFor(async () => (await storage(b.worker, 'session')).session?.state === 'IDLE');
    await waitFor(async () => Object.keys((await storage(b.worker, 'pending')).pending || {}).length === 0);

    const final = await storage(b.worker, ['session', 'pending']);
    assert.equal(final.session?.state, 'IDLE');
    assert.deepEqual(final.pending, {});

    const created = await collector.evaluate(() => window.__dl);
    const contents = created.map(i => decodeDataUrl(i.url)).filter(Boolean);

    const summary = contents.find(c => c.includes('ExamEye summary'));
    assert.ok(summary, 'expected a summary.txt write');
    assert.match(summary, /Outcome: RESULT/);
    assert.match(summary, /Log chain: OK \(\d+ lines\)/);

    const log = contents.find(c => c.startsWith('# ExamEye session'));
    assert.ok(log, 'expected a log.txt write');
    assert.ok(log.split('\n')[0].includes(armed.id), `expected the header line to carry the session id, got: ${log.split('\n')[0]}`);

    assert.ok(created.some(i => i.url?.startsWith('data:image/jpeg')), 'expected at least one screenshot download');
  } finally {
    await b.close();
    site.server.close();
  }
});
