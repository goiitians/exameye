import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.js';

const config = { startPrefix: 'https://e.x/start', examPrefix: '', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10, startButton: '', endButton: '', endMarker: '', maxMin: 0, tailMin: 0, desktopCapture: 'off', desktopRepromptMin: 5 };
const later = () => new Promise((r) => setTimeout(r, 20));

test('a service worker start without the tick alarm boots fully', async () => {
  const chrome = installFakeChrome();
  await chrome.storage.local.set({ config });
  const sw = await import('../../src/sw.js?boot=1');
  await later();
  await sw.settled();
  assert.deepEqual(chrome.alarms.alarms.tick, { periodInMinutes: 0.5 });
  assert.deepEqual(chrome.alarms.alarms.periodic, { periodInMinutes: 10 });
  assert.equal(chrome.scripting.registered.length, 1);
  assert.deepEqual(chrome.downloads.uiOptions, { enabled: false });
});

test('a service worker start with the tick alarm present only re-applies the download UI option', async () => {
  const chrome = installFakeChrome();
  await chrome.storage.local.set({ config });
  chrome.alarms.alarms.tick = { periodInMinutes: 0.5 };
  const sw = await import('../../src/sw.js?boot=2');
  await later();
  await sw.settled();
  assert.equal(chrome.scripting.registered.length, 0);
  assert.equal(chrome.alarms.alarms.periodic, undefined);
  assert.deepEqual(chrome.downloads.uiOptions, { enabled: false });
});
