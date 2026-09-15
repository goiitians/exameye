import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startSite, launch, storage, waitFor } from './harness.js';
import { verify } from '../../src/core/hashchain.js';

const decodeDataUrl = (url) => {
  const m = /^data:[^;]+;base64,(.*)$/s.exec(url || '');
  return m ? Buffer.from(m[1], 'base64').toString('utf8') : null;
};

test('arm on start page, record a tab switch, disarm on result, files written', async () => {
  const site = await startSite();
  const config = { startPrefix: `${site.origin}/exam/start.html`, examPrefix: '', resultPrefix: `${site.origin}/exam/result.html`, seat: 'T1', subfolder: 'ExamEyeTest', shotIntervalMin: 10, abandonMin: 10, startButton: '', endButton: '', endMarker: '', maxMin: 0, tailMin: 0, desktopCapture: 'off', desktopRepromptMin: 5 };
  const b = await launch(config);
  let collector;
  try {
    // chrome.downloads.search() is empty under Playwright's CDP download-behavior override, so
    // downloads are read back live via onCreated from an extension page instead (kept open for the run).
    const extId = new URL(b.worker.url()).host;
    collector = await b.context.newPage();
    await collector.goto(`chrome-extension://${extId}/src/options/options.html`);
    await collector.evaluate(() => {
      window.__dl = [];
      window.__dlc = [];
      chrome.downloads.onCreated.addListener((i) => window.__dl.push(i));
      chrome.downloads.onChanged.addListener((d) => { if (d.state) window.__dlc.push({ id: d.id, state: d.state.current }); });
    });
    await b.page.bringToFront();

    await b.page.goto(`${site.origin}/exam/start.html?c=1`);
    await waitFor(async () => (await storage(b.worker, 'session')).session?.state === 'ARMED');
    const { session: armed } = await storage(b.worker, 'session');
    // proves the content script's port-bearing match pattern actually registered on real
    // Chromium (not just in the fake): a real right-click dispatches a real contextmenu event.
    await b.page.click('h1', { button: 'right' });
    await b.page.keyboard.press('Escape');
    await waitFor(async () => ((await storage(b.worker, 'events')).events || []).some(e => e.name === 'CONTEXTMENU'));
    const contextEvents = (await storage(b.worker, 'events')).events || [];
    assert.ok(contextEvents.some(e => e.name === 'CONTEXTMENU'), 'expected a CONTEXTMENU event from the real right-click');
    // SESSION_ARMED already took a screenshot; sw.js coalesces any further shot within
    // SHOT_GAP_MS (2000ms) onto that same file, so wait it out to get a distinct TAB_SWITCH shot.
    await new Promise(r => setTimeout(r, 2100));
    // A plain context.newPage() activates a blank tab immediately (before navigation), which the
    // extension would capture as the away-episode's TAB_SWITCH with a failed screenshot (Chrome
    // can't capture about:blank). Creating it as a background CDP target defers activation until
    // it's already loaded, so the real TAB_SWITCH captured below gets a genuine screenshot.
    const otherPagePromise = b.context.waitForEvent('page');
    await b.cdp.send('Target.createTarget', { url: `${site.origin}/other.html`, background: true });
    const other = await otherPagePromise;
    await other.waitForLoadState('load');
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

    const readDl = () => collector.evaluate(() => window.__dl);
    await waitFor(async () => {
      const items = await readDl();
      return items.some(i => i.mime === 'text/plain' && (decodeDataUrl(i.url) || '').includes('ExamEye summary'));
    });
    const created = await readDl();

    const textPlain = created.filter(i => i.mime === 'text/plain').map(i => decodeDataUrl(i.url)).filter(Boolean);
    const summary = textPlain.find(c => c.includes('ExamEye summary'));
    assert.ok(summary, 'expected a summary.txt write');
    assert.match(summary, /Outcome: RESULT/);

    // log.txt is rewritten on every flush; the last write holding the header is the final state.
    const log = textPlain.filter(c => c.startsWith('# ExamEye session')).at(-1);
    assert.ok(log, 'expected a log.txt write');
    assert.ok(log.split('\n')[0].includes(armed.id), `expected the header line to carry the session id, got: ${log.split('\n')[0]}`);
    assert.deepEqual(await verify(log.trimEnd().split('\n')), { ok: true, firstBad: -1 });

    const eventsItem = created.find(i => i.mime === 'application/json');
    assert.ok(eventsItem, 'expected an events.jsonl write');
    const events = decodeDataUrl(eventsItem.url).trimEnd().split('\n').map(l => JSON.parse(l));
    const tabSwitch = events.find(e => e.name === 'TAB_SWITCH');
    assert.ok(tabSwitch, 'expected a TAB_SWITCH event in events.jsonl');
    assert.ok(tabSwitch.shot?.endsWith('_TAB_SWITCH.jpg'), `expected a screenshot for TAB_SWITCH, got ${tabSwitch.shot}`);

    const jpegs = created.filter(i => i.mime === 'image/jpeg');
    assert.ok(jpegs.length >= 2, `expected distinct screenshots for SESSION_ARMED and TAB_SWITCH, got ${jpegs.length}`);

    const html = created.find(i => i.mime === 'text/html');
    assert.ok(html && decodeDataUrl(html.url), 'expected summary.html to have been written');
  } finally {
    // closing the context while an extension download is still in progress makes Chromium show
    // a native "Download is in progress" quit dialog and keeps the window open.
    if (collector) {
      await waitFor(() => collector.evaluate(() => {
        const done = new Set(window.__dlc.filter(c => c.state === 'complete' || c.state === 'interrupted').map(c => c.id));
        return window.__dl.every(i => i.state === 'complete' || done.has(i.id));
      })).catch(e => console.warn(`download drain: ${e.message}`));
    }
    await b.close();
    site.server.close();
  }
});

// Chrome's native "Choose what to share" picker cannot be dismissed from Playwright (it is not a
// page dialog; keyboard input goes to the page), so no scenario here exercises the decline path -
// decline/stop/closed are covered by the sw-desktop and desktop-core unit tests instead.
test('desktop capture: auto-accepted share logs STARTED, a PERIODIC desktop frame and the summary line', async () => {
  const site = await startSite();
  const config = { startPrefix: `${site.origin}/exam/start.html`, examPrefix: '', resultPrefix: `${site.origin}/exam/result.html`, seat: 'T4', subfolder: 'ExamEyeTest', shotIntervalMin: 10, abandonMin: 10, startButton: '', endButton: '', endMarker: '', maxMin: 0, tailMin: 0, desktopCapture: 'on', desktopRepromptMin: 0 };
  const b = await launch(config, { args: ['--auto-select-desktop-capture-source=Entire screen'] });
  let collector;
  try {
    collector = await collectDownloads(b);
    await b.page.bringToFront();

    await b.page.goto(`${site.origin}/exam/start.html?c=1`);
    await waitFor(async () => (await storage(b.worker, 'session')).session?.state === 'ARMED');
    await waitFor(async () => ((await storage(b.worker, 'events')).events || []).some(e => e.name === 'DESKTOP_CAPTURE_STARTED'), 20000);
    const { meta } = await storage(b.worker, 'meta');
    assert.equal(meta.desktop?.state, 'on');
    assert.ok(b.context.pages().some(p => p.url().endsWith('/src/holder/holder.html')), 'expected a holder page');

    const beforeAlarm = (await collector.evaluate(() => window.__dl)).filter(i => i.mime === 'image/jpeg').length;
    await b.worker.evaluate(() => chrome.alarms.create('periodic', { when: Date.now() + 500 }));
    await waitFor(async () => ((await storage(b.worker, 'events')).events || []).some(e => e.name === 'PERIODIC' && /^screenshots\/desktop\//.test(e.data.desktopShot || '')));
    await waitFor(async () => Object.keys((await storage(b.worker, 'pending')).pending || {}).length === 0);
    await waitFor(async () => (await collector.evaluate(() => window.__dl)).filter(i => i.mime === 'image/jpeg').length > beforeAlarm);

    await b.page.goto(`${site.origin}/exam/result.html`);
    await waitFor(async () => (await storage(b.worker, 'session')).session?.state === 'IDLE');

    const readDl = () => collector.evaluate(() => window.__dl);
    await waitFor(async () => {
      const items = await readDl();
      return items.some(i => i.mime === 'text/plain' && (decodeDataUrl(i.url) || '').includes('ExamEye summary'));
    });
    const textPlain = (await readDl()).filter(i => i.mime === 'text/plain').map(i => decodeDataUrl(i.url)).filter(Boolean);
    const summary = textPlain.find(c => c.includes('ExamEye summary'));
    assert.ok(summary, 'expected a summary.txt write');
    assert.match(summary, /^Desktop:   on \d\d:\d\d:\d\d - \d\d:\d\d:\d\d \(\d+ frames\)$/m);
    assert.match(summary, /^Desktop frames: [1-9]\d* \(screenshots\/desktop\/\)$/m);

    const log = textPlain.filter(c => c.startsWith('# ExamEye session')).at(-1);
    assert.ok(log, 'expected a log.txt write');
    assert.deepEqual(await verify(log.trimEnd().split('\n')), { ok: true, firstBad: -1 });

    const eventsItem = (await readDl()).find(i => i.mime === 'application/json');
    assert.ok(eventsItem, 'expected an events.jsonl write');
    const events = decodeDataUrl(eventsItem.url).trimEnd().split('\n').map(l => JSON.parse(l));
    assert.ok(!events.some(e => e.name === 'WINDOW_OPENED'), 'expected no WINDOW_OPENED for the holder window');
    assert.ok(!events.some(e => e.name === 'PARALLEL_PAGE' && (e.data.url || '').startsWith('chrome-extension://')), 'expected no PARALLEL_PAGE for the holder page');
  } finally {
    await drainDownloads(collector);
    await b.close();
    site.server.close();
  }
});

async function collectDownloads(b) {
  const extId = new URL(b.worker.url()).host;
  const collector = await b.context.newPage();
  await collector.goto(`chrome-extension://${extId}/src/options/options.html`);
  await collector.evaluate(() => {
    window.__dl = [];
    window.__dlc = [];
    chrome.downloads.onCreated.addListener((i) => window.__dl.push(i));
    chrome.downloads.onChanged.addListener((d) => { if (d.state) window.__dlc.push({ id: d.id, state: d.state.current }); });
  });
  return collector;
}

async function drainDownloads(collector) {
  if (!collector) return;
  await waitFor(() => collector.evaluate(() => {
    const done = new Set(window.__dlc.filter(c => c.state === 'complete' || c.state === 'interrupted').map(c => c.id));
    return window.__dl.every(i => i.state === 'complete' || done.has(i.id));
  })).catch(e => console.warn(`download drain: ${e.message}`));
}

test('start button arms; confirm click starts the tail; tab close ends with SUBMITTED', async () => {
  const site = await startSite();
  const config = { startPrefix: `${site.origin}/exam/paper.html`, examPrefix: '', resultPrefix: '', seat: 'T2', subfolder: 'ExamEyeTest', shotIntervalMin: 10, abandonMin: 10, startButton: 'Start', endButton: 'Confirm submission', endMarker: 'Your answers have been submitted', maxMin: 0, tailMin: 1, desktopCapture: 'off', desktopRepromptMin: 5 };
  const b = await launch(config);
  let collector;
  try {
    collector = await collectDownloads(b);
    await b.page.bringToFront();

    await b.page.goto(`${site.origin}/exam/paper.html`);
    await new Promise(r => setTimeout(r, 1000));
    assert.equal((await storage(b.worker, 'session')).session?.state, 'IDLE');

    await b.page.click('#start');
    await waitFor(async () => (await storage(b.worker, 'session')).session?.state === 'ARMED');
    const { events: armEvents } = await storage(b.worker, 'events');
    assert.equal(armEvents.find(e => e.name === 'SESSION_ARMED')?.data.trigger, 'button');

    await b.page.click('#next');
    await b.page.click('#next');
    await b.page.click('#next');
    await b.page.click('#finish');
    await b.page.click('#confirm');
    await waitFor(async () => (await storage(b.worker, 'session')).session?.state === 'CLOSING');
    assert.equal((await storage(b.worker, 'session')).session?.outcome, 'SUBMITTED');

    await waitFor(async () => ((await storage(b.worker, 'events')).events || []).some(e => e.name === 'END_MARKER_SEEN'));
    await waitFor(async () => ((await storage(b.worker, 'events')).events || []).some(e => e.name === 'SCREEN_CHANGED' && e.data.phase === 'tail' && e.shot));

    await b.page.close();
    await waitFor(async () => (await storage(b.worker, 'session')).session?.state === 'IDLE');

    const readDl = () => collector.evaluate(() => window.__dl);
    await waitFor(async () => {
      const items = await readDl();
      return items.some(i => i.mime === 'text/plain' && (decodeDataUrl(i.url) || '').includes('ExamEye summary'));
    });
    const textPlain = (await readDl()).filter(i => i.mime === 'text/plain').map(i => decodeDataUrl(i.url)).filter(Boolean);
    const summary = textPlain.find(c => c.includes('ExamEye summary'));
    assert.ok(summary, 'expected a summary.txt write');
    assert.match(summary, /Outcome: SUBMITTED/);
    assert.match(summary, /Trigger:   end button "confirm submission" clicked/);
    assert.match(summary, /Post-submit tail/);
  } finally {
    await drainDownloads(collector);
    await b.close();
    site.server.close();
  }
});

test('auto-submit: marker alone ends the exam phase as AUTO_SUBMITTED', async () => {
  const site = await startSite();
  const config = { startPrefix: `${site.origin}/exam/paper.html`, examPrefix: '', resultPrefix: '', seat: 'T3', subfolder: 'ExamEyeTest', shotIntervalMin: 10, abandonMin: 10, startButton: 'Start', endButton: 'Confirm submission', endMarker: 'Your answers have been submitted', maxMin: 0, tailMin: 1, desktopCapture: 'off', desktopRepromptMin: 5 };
  const b = await launch(config);
  let collector;
  try {
    collector = await collectDownloads(b);
    await b.page.bringToFront();

    await b.page.goto(`${site.origin}/exam/paper.html?auto=1`);
    await b.page.click('#start');
    await waitFor(async () => (await storage(b.worker, 'session')).session?.state === 'ARMED');

    await waitFor(async () => ((await storage(b.worker, 'events')).events || []).some(e => e.name === 'END_MARKER_SEEN'), 8000);
    const { session: closing, events } = await storage(b.worker, ['session', 'events']);
    assert.equal(closing.state, 'CLOSING');
    assert.equal(closing.outcome, 'AUTO_SUBMITTED');
    assert.ok(!(events || []).some(e => e.name === 'END_BUTTON_CLICKED'), 'expected no END_BUTTON_CLICKED');

    await b.page.close();
    await waitFor(async () => (await storage(b.worker, 'session')).session?.state === 'IDLE');

    const readDl = () => collector.evaluate(() => window.__dl);
    await waitFor(async () => {
      const items = await readDl();
      return items.some(i => i.mime === 'text/plain' && (decodeDataUrl(i.url) || '').includes('ExamEye summary'));
    });
    const textPlain = (await readDl()).filter(i => i.mime === 'text/plain').map(i => decodeDataUrl(i.url)).filter(Boolean);
    const summary = textPlain.find(c => c.includes('ExamEye summary'));
    assert.ok(summary, 'expected a summary.txt write');
    assert.match(summary, /Outcome: AUTO_SUBMITTED/);
    assert.match(summary, /end marker "your answers have been submitted" seen/);
  } finally {
    await drainDownloads(collector);
    await b.close();
    site.server.close();
  }
});
