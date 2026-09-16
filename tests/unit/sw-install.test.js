import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.js';

const defaults = { startPrefix: 'https://exam.example.com/index.html', examPrefix: 'https://exam.example.com/panel/', resultPrefix: 'https://exam.example.com/results/', seat: ' C01 ', subfolder: 'ExamEye', shotIntervalMin: '5', abandonMin: 15, startButton: 'Proceed', endButton: 'Submit', endMarker: 'Subject Analysis', maxMin: 190, tailMin: 5, desktopCapture: 'on', desktopRepromptMin: 1 };
const later = () => new Promise((r) => setTimeout(r, 30));
const withFetch = (body) => { globalThis.fetch = async (url) => { if (!String(url).endsWith('/defaults.json')) throw new Error('unexpected ' + url); if (body === null) throw new Error('404'); return { json: async () => body }; }; };

test('first install with defaults.json next to the manifest seeds the settings, normalised, and opens the setup page', async () => {
  const chrome = installFakeChrome();
  withFetch(defaults);
  const sw = await import('../../src/sw.js?install=1');
  await chrome.runtime.onInstalled.emit({ reason: 'install' });
  await later();
  await sw.settled();
  const { config } = await chrome.storage.local.get('config');
  assert.equal(config.seat, 'C01');
  assert.equal(config.shotIntervalMin, 5);
  assert.equal(config.startButton, 'Proceed');
  assert.equal(chrome.runtime.optionsOpened, 1);
  assert.equal(chrome.scripting.registered.length, 1, 'the seeded settings are applied: content script registered');
  assert.deepEqual((await chrome.storage.local.get('meta')).meta.configErrors, []);
});

test('an update never overwrites saved settings and does not open the setup page', async () => {
  const chrome = installFakeChrome();
  withFetch(defaults);
  await chrome.storage.local.set({ config: { ...defaults, seat: 'C07' } });
  const sw = await import('../../src/sw.js?install=2');
  await chrome.runtime.onInstalled.emit({ reason: 'update' });
  await later();
  await sw.settled();
  assert.equal((await chrome.storage.local.get('config')).config.seat, 'C07');
  assert.equal(chrome.runtime.optionsOpened, 0);
});

test('a first install with saved settings already present (re-install over an existing profile) keeps them', async () => {
  const chrome = installFakeChrome();
  withFetch(defaults);
  await chrome.storage.local.set({ config: { ...defaults, seat: 'C09' } });
  const sw = await import('../../src/sw.js?install=3');
  await chrome.runtime.onInstalled.emit({ reason: 'install' });
  await later();
  await sw.settled();
  assert.equal((await chrome.storage.local.get('config')).config.seat, 'C09');
  assert.equal(chrome.runtime.optionsOpened, 1);
});

test('without defaults.json a first install stores nothing and still opens the setup page', async () => {
  const chrome = installFakeChrome();
  withFetch(null);
  const sw = await import('../../src/sw.js?install=4');
  await chrome.runtime.onInstalled.emit({ reason: 'install' });
  await later();
  await sw.settled();
  assert.equal((await chrome.storage.local.get('config')).config, undefined);
  assert.equal(chrome.runtime.optionsOpened, 1);
});
