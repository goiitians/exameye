// Captures the real product screens used by docs/deck: options page (clean, with an error, while
// recording), popup while ARMED, screen-capture holder, chrome://extensions with ExamEye loaded,
// and summary.html of a short scripted paper. Run: node tools/deck-shots.mjs
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { startSite, storage, waitFor } from '../tests/integration/harness.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'docs/deck/img');
const PROFILES = path.join(ROOT, 'playwright-profile');
const decode = (url) => { const m = /^data:[^;]+;base64,(.*)$/s.exec(url || ''); return m ? Buffer.from(m[1], 'base64') : null; };

await mkdir(OUT, { recursive: true });
const site = await startSite();
const config = {
  startPrefix: `${site.origin}/exam/start.html`, examPrefix: '', resultPrefix: `${site.origin}/exam/result.html`,
  seat: 'C12-S07', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10, startButton: '', endButton: 'Finish, Confirm submission',
  endMarker: '', maxMin: 200, tailMin: 5, desktopCapture: 'off', desktopRepromptMin: 5,
};
await mkdir(PROFILES, { recursive: true });
const profile = await mkdtemp(path.join(PROFILES, 'deck-'));
let downloads = null;
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: false, viewport: { width: 1000, height: 760 }, deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
});
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extId = new URL(worker.url()).host;
  const ext = (p) => `chrome-extension://${extId}/${p}`;
  await worker.evaluate((cfg) => chrome.storage.local.set({ config: cfg }), config);
  const page = context.pages()[0] || await context.newPage();
  downloads = await mkdtemp(path.join(PROFILES, 'deck-dl-'));
  await (await context.newCDPSession(page)).send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
  const shot = (p, name, opts = {}) => p.screenshot({ path: path.join(OUT, name), ...opts });

  // downloads are read back live from an extension page (chrome.downloads.search is empty under Playwright)
  const collector = await context.newPage();
  await collector.goto(ext('src/options/options.html'));
  await collector.evaluate(() => {
    window.__dl = [];
    chrome.downloads.onCreated.addListener((i) => window.__dl.push(i));
    // the target path is only known once Chrome has resolved it, which arrives as an onChanged delta
    chrome.downloads.onChanged.addListener((d) => { const it = window.__dl.find(i => i.id === d.id); if (it && d.filename) it.filename = d.filename.current; });
  });

  // 1. options page, clean
  const options = await context.newPage();
  await options.goto(ext('src/options/options.html'));
  await options.waitForFunction(() => document.querySelector('#dest').textContent.includes('ExamEye'));
  await options.setViewportSize({ width: 1000, height: 2160 });
  await shot(options, 'options-clean.png');
  // two readable halves for the printed guide and the slide: sections 1-2, sections 3-5
  await shot(options, 'options-part1.png', { clip: { x: 0, y: 0, width: 1000, height: 1120 } });
  await shot(options, 'options-part2.png', { clip: { x: 0, y: 1120, width: 1000, height: 1040 } });
  await options.setViewportSize({ width: 1000, height: 760 });

  // 2. options page with an inline error
  await options.fill('#startPrefix', 'exam.example.com/start');
  await options.click('button[type=submit]');
  await options.waitForSelector('#err-startPrefix:not([hidden])');
  await shot(options, 'options-error.png', { clip: { x: 0, y: 0, width: 1000, height: 620 } });
  await options.fill('#startPrefix', config.startPrefix);
  await options.click('button[type=submit]');
  await options.waitForFunction(() => document.querySelector('#status').textContent === 'Saved.');

  // 3. chrome://extensions with ExamEye loaded
  const extPage = await context.newPage();
  await extPage.goto('chrome://extensions');
  await extPage.waitForTimeout(800);
  await shot(extPage, 'chrome-extensions.png', { clip: { x: 0, y: 0, width: 1000, height: 380 } });
  // Developer mode on: the toolbar with "Load unpacked" appears (Chrome's own page, real)
  try {
    await extPage.locator('#devMode').click({ timeout: 3000 });
    await extPage.waitForTimeout(600);
    await shot(extPage, 'chrome-extensions-devmode.png', { clip: { x: 0, y: 0, width: 1000, height: 420 } });
  } catch (e) { console.warn('developer-mode toggle not captured:', e.message); }
  await extPage.close();

  // 4. holder page (script blocked so it does not close itself)
  await context.route('**/holder.js', (r) => r.abort());
  const holder = await context.newPage();
  await holder.setViewportSize({ width: 460, height: 140 });
  await holder.goto(ext('src/holder/holder.html'));
  await shot(holder, 'holder.png');
  await holder.close();
  await context.unroute('**/holder.js');

  // popup opened now (background) so its tab is never a parallel page of the paper; it re-renders on every storage change
  const popupPromise = context.waitForEvent('page');
  await (await context.newCDPSession(page)).send('Target.createTarget', { url: ext('src/popup/popup.html'), background: true });
  const popup = await popupPromise;
  await popup.setViewportSize({ width: 344, height: 460 });

  // 5. a short scripted paper: arm, right-click, tab switch, copy, submit (no tail, so the run ends at once)
  await worker.evaluate((cfg) => chrome.storage.local.set({ config: cfg }), { ...config, tailMin: 0 });
  const cdp = await context.newCDPSession(page);
  await page.bringToFront();
  await page.goto(`${site.origin}/exam/start.html?candidate=1`);
  await waitFor(async () => (await storage(worker, 'session')).session?.state === 'ARMED');
  await shot(page, 'exam-start.png');
  // the options page follows the session through storage.onChanged: no reload, so it never becomes a parallel page
  await options.waitForSelector('#recording:not([hidden])');
  await shot(options, 'options-recording.png', { clip: { x: 0, y: 0, width: 1000, height: 420 } });
  await page.bringToFront();
  await page.click('h1', { button: 'right' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2200);
  const otherPromise = context.waitForEvent('page');
  await cdp.send('Target.createTarget', { url: `${site.origin}/other.html`, background: true });
  const other = await otherPromise;
  await other.waitForLoadState('load');
  await other.bringToFront();
  await waitFor(async () => ((await storage(worker, 'events')).events || []).some(e => e.name === 'TAB_SWITCH'));
  await other.waitForTimeout(2500);
  await page.bringToFront();
  await page.evaluate(() => document.execCommand('copy'));
  await waitFor(async () => ((await storage(worker, 'events')).events || []).some(e => e.name === 'COPY'));

  // 6. popup while ARMED (rendered as a page at popup width)
  await popup.waitForFunction(() => document.querySelector('#state').textContent === 'ARMED');
  await shot(popup, 'popup-armed.png');
  await popup.close();

  // 7. submit and let the tail end at once, then collect the files
  await page.bringToFront();
  await page.goto(`${site.origin}/exam/result.html`);
  await waitFor(async () => (await storage(worker, 'session')).session?.state === 'IDLE');
  await waitFor(async () => Object.keys((await storage(worker, 'pending')).pending || {}).length === 0);
  // Chrome ignores the extension's target path under the CDP download override (every item is
  // download.txt / download.jpeg), so the folder is rebuilt from the contents: the text files are
  // self-identifying and the JPEGs arrive in the same order as the events that name them.
  await waitFor(async () => (await collector.evaluate(() => window.__dl)).some(i => i.mime === 'text/html'));
  const items = await collector.evaluate(() => window.__dl);
  const texts = items.filter(i => i.mime !== 'image/jpeg').map(i => decode(i.url)?.toString('utf8') || '');
  const log = texts.filter(t => t.startsWith('# ExamEye session')).at(-1);
  const isEvents = (t) => { try { const a = JSON.parse(t); return Array.isArray(a) && typeof a[0]?.seq === 'number'; } catch { return false; } };
  const eventsJson = texts.find(isEvents);
  const summaryTxt = texts.find(t => t.startsWith('ExamEye summary'));
  const summaryHtml = texts.find(t => t.startsWith('<!doctype html>'));
  if (!log || !eventsJson || !summaryTxt || !summaryHtml) {
    console.error('items:', JSON.stringify(items.map(i => [i.mime, (i.url || '').slice(0, 40), (decode(i.url) || '').toString('utf8').slice(0, 30)])));
    throw new Error('could not identify the session files');
  }
  const events = JSON.parse(eventsJson);
  const shotNames = [...new Set(events.flatMap(e => [e.shot, e.data?.desktopShot]).filter(Boolean))];
  const jpegs = items.filter(i => i.mime === 'image/jpeg').map(i => decode(i.url));
  if (jpegs.length !== shotNames.length) throw new Error(`${jpegs.length} JPEG downloads for ${shotNames.length} shot names`);
  const id = /^# ExamEye session (\S+)/.exec(log)[1];
  const sample = path.join(ROOT, 'docs/deck/sample-session', 'ExamEye', id);
  const files = new Map([['log.txt', Buffer.from(log)], ['events.json', Buffer.from(eventsJson)], ['summary.txt', Buffer.from(summaryTxt)], ['summary.html', Buffer.from(summaryHtml)]]);
  shotNames.forEach((f, i) => files.set(f, jpegs[i]));
  for (const [f, buf] of files) { await mkdir(path.dirname(path.join(sample, f)), { recursive: true }); await writeFile(path.join(sample, f), buf); }
  const summary = await context.newPage();
  await summary.setViewportSize({ width: 1200, height: 900 });
  await summary.goto('file://' + path.join(sample, 'summary.html'));
  await summary.waitForTimeout(500);
  await shot(summary, 'summary-top.png');
  await shot(summary, 'summary-full.png', { fullPage: true });
  await summary.locator('xpath=//h2[contains(., "Timeline")]/following-sibling::table[1]').screenshot({ path: path.join(OUT, 'summary-timeline.png') });
  await summary.close();
  await writeFile(path.join(OUT, 'files.json'), JSON.stringify({ id, files: [...files.keys()].sort() }, null, 2));
  console.log('wrote', files.size, 'session files for', id, 'and screenshots to', OUT);
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
  if (downloads) await rm(downloads, { recursive: true, force: true });
  site.server.close();
}
