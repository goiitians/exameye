import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SITE = path.join(import.meta.dirname, 'site');
const PROFILES = path.join(ROOT, 'playwright-profile');

export async function startSite() {
  const server = createServer(async (req, res) => {
    try {
      res.setHeader('content-type', 'text/html');
      res.end(await readFile(path.join(SITE, req.url.split('?')[0])));
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

export async function launch(config, { args = [] } = {}) {
  await mkdir(PROFILES, { recursive: true });
  const profile = await mkdtemp(path.join(PROFILES, 'profile-'));
  const downloads = await mkdtemp(path.join(PROFILES, 'dl-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: false,
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`, ...args],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = context.pages()[0] || await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
  await worker.evaluate((cfg) => chrome.storage.local.set({ config: cfg }), config);
  const close = async () => {
    await context.close();
    // only the two exact mkdtemp dirs this launch() call created above, nothing else
    await rm(profile, { recursive: true, force: true });
    await rm(downloads, { recursive: true, force: true });
  };
  return { context, worker, page, downloads, cdp, close };
}

export const storage = (worker, keys) => worker.evaluate((k) => chrome.storage.local.get(k), keys);

export async function waitFor(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('waitFor timed out');
}
