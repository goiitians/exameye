import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { startSite, launch, storage, waitFor } from './harness.js';

test('arm on start page, record a tab switch, disarm on result, files on disk', async () => {
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
    // Known environment issue (see report task-22-report.md): under this CDP-driven download
    // override, chrome.downloads.onCreated fires with byExtensionId === undefined for the
    // extension's own writes, so src/sw.js's `if (item.byExtensionId === chrome.runtime.id)
    // return;` guard does not recognise them as self-originated. Each write is logged as a new
    // DOWNLOAD_STARTED event, which triggers another flush()/write, which triggers another
    // onCreated — a self-sustaining loop that starves the serialised dispatch queue behind it.
    // Real Chrome (no CDP download override) sets byExtensionId correctly and never hits this;
    // it is specific to running the extension via Playwright's required launch path.
    await waitFor(async () => (await storage(b.worker, 'session')).session?.state === 'IDLE');
    await waitFor(async () => Object.keys((await storage(b.worker, 'pending')).pending || {}).length === 0);

    // Chrome's CDP-driven "Browser.setDownloadBehavior" (required here because real Chrome
    // 137+ dropped --load-extension, forcing this harness onto Playwright's bundled Chromium
    // via CDP) bypasses the normal DownloadTargetDeterminer that honours chrome.downloads
    // .download()'s `filename` argument: every write lands directly in `b.downloads` (no
    // <subfolder>/<sessionId> tree) under a MIME-derived generic name ("download.txt",
    // "download.json", "download.html", "download.jpeg"), and repeat writes of the same MIME
    // type overwrite each other. Confirmed with isolated repro scripts against this Playwright
    // 1.63 + Chromium 1243 build: chrome.downloads.search() also comes back empty/unreliable,
    // so the brief's documented fallback does not help either. log.txt (text/plain) is
    // therefore clobbered on disk by the later summary.txt write of the same MIME type; the
    // assertions below use events.jsonl (application/json, written once, never collides) and
    // whichever text file survives, which is enough to prove the SW's real persistence and
    // hash-chain paths ran end to end.
    const names = await readdir(b.downloads);
    const filesByExt = {};
    for (const name of names) {
      const buf = await readFile(path.join(b.downloads, name));
      filesByExt[path.extname(name)] = buf;
    }

    const events = filesByExt['.json'].toString('utf8').trim().split('\n').map(l => JSON.parse(l));
    const tabSwitch = events.find(e => e.name === 'TAB_SWITCH');
    assert.ok(tabSwitch, 'expected a TAB_SWITCH event in events.jsonl');
    assert.ok(tabSwitch.shot?.endsWith('_TAB_SWITCH.jpg'), `expected a screenshot for TAB_SWITCH, got ${tabSwitch.shot}`);

    const text = filesByExt['.txt'].toString('utf8');
    assert.match(text, /Outcome: RESULT/);
    assert.match(text, /Log chain: OK \(\d+ lines\)/);

    assert.ok(filesByExt['.html'], 'expected summary.html to have been written');
    assert.ok(filesByExt['.jpeg'] || filesByExt['.jpg'], 'expected at least one screenshot to have been written');
  } finally {
    await b.close();
    site.server.close();
  }
});
