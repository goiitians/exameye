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
    await b.page.goto(`${site.origin}/exam/start.html?c=1`);
    await waitFor(async () => (await storage(b.worker, 'session')).session?.state === 'ARMED');
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

    // Under Playwright's CDP `Browser.setDownloadBehavior` override, real Chrome doesn't honour
    // chrome.downloads.download()'s `filename` argument the way a non-automated install does, so
    // asserting on-disk paths is unreliable here. Instead, read back what the extension itself
    // wrote via chrome.downloads.search() (each item's `url` is the original data: URL) and check
    // the decoded content, which exercises the real persistence path end to end.
    //
    // KNOWN BLOCKER (fix-round-1, see task-22-report.md): chrome.downloads.search({}) reliably
    // returns [] in this environment, even querying by id or by state:'complete' immediately
    // after a single manual download() call. This is not a timing/flakiness issue -
    // onCreated/onChanged fire with full data (url, resolved filename, state:'complete') on the
    // same item, but the item is never inserted into whatever backing store search() reads under
    // this CDP override. This assertion is expected to fail until a working read-back mechanism
    // is found (e.g. capturing onCreated/onChanged live instead of querying after the fact).
    const items = await b.worker.evaluate(() => chrome.downloads.search({}));
    const contents = items.map(i => decodeDataUrl(i.url)).filter(Boolean);

    const summary = contents.find(c => c.includes('ExamEye summary'));
    assert.ok(summary, 'expected a summary.txt write');
    assert.match(summary, /Outcome: RESULT/);
    assert.match(summary, /Log chain: OK \(\d+ lines\)/);

    const log = contents.find(c => c.startsWith('# ExamEye session'));
    assert.ok(log, 'expected a log.txt write');
  } finally {
    await b.close();
    site.server.close();
  }
});
