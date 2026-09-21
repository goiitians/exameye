import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { installFakeChrome } from './fake-chrome.js';
import { installFakeDom } from './fake-dom.js';

const chrome = installFakeChrome();
const dom = installFakeDom(['state', 'session', 'flush', 'errors', 'counts', 'options', 'desktop', 'flags']);
dom.options.hidden = true;
const opened = [];
chrome.runtime.openOptionsPage = async () => { opened.push(1); };
const tick = () => new Promise((r) => setTimeout(r, 5));

test('popup has the live-state slots and a module script', async () => {
  const html = await readFile(new URL('../../src/popup/popup.html', import.meta.url), 'utf8');
  for (const id of ['state', 'session', 'flush', 'errors', 'counts', 'options', 'desktop', 'flags']) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /<script type="module" src="popup.js"><\/script>/);
});

test('render: idle with nothing stored', async () => {
  await import('../../src/popup/popup.js');
  await tick();
  assert.deepEqual(chrome.runtime.ports.map(p => p.name), ['popup'], 'the popup opens a port so the SW can tell its own UI has focus');
  // a service-worker restart drops the port; the popup, still open, reconnects so the new SW sees it
  await chrome.runtime.ports[0].disconnect();
  await tick();
  assert.equal(chrome.runtime.ports.length, 2);
  assert.equal(dom.state.textContent, 'IDLE');
  assert.equal(dom.session.textContent, '-');
  assert.equal(dom.flush.textContent, 'never');
  assert.equal(dom.errors.textContent, '-');
  assert.equal(dom.counts.textContent, '(no events)');
  assert.equal(dom.desktop.textContent, 'off');
  assert.equal(dom.flags.textContent, '0');
});

test('render shows the desktop line', async () => {
  const since = Date.UTC(2026, 8, 13, 9, 0, 0);
  await chrome.storage.local.set({
    meta: { desktop: { state: 'on', at: since, since, holderWindowId: 1, asks: 1, width: 1920, height: 1080, error: null, nextAskAt: null } },
    events: [{ name: 'FOCUS_LEFT_CHROME', data: { desktopShot: 'screenshots/desktop/a.jpg' } }, { name: 'FOCUS_LEFT_CHROME', data: { desktopShot: 'screenshots/desktop/b.jpg' } }],
  });
  await tick();
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date(since);
  const hms = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  assert.equal(dom.desktop.textContent, `on since ${hms} (2 frames)`);
  assert.equal(dom.flags.textContent, '2');
});

test('the Open options link is shown only while the config is invalid, and opens the options page', async () => {
  await chrome.storage.local.set({ meta: { configErrors: [{ field: 'seat', message: 'required' }] } });
  await tick();
  assert.equal(dom.options.hidden, false);
  dom.options.click();
  assert.equal(opened.length, 1);
  await chrome.storage.local.set({ meta: { configErrors: [] } });
  await tick();
  assert.equal(dom.options.hidden, true);
});

test('render: armed session, counters, and every error source listed', async () => {
  await chrome.storage.local.set({
    session: { state: 'ARMED', id: '20260913-090000_A17' },
    events: [{ name: 'SESSION_ARMED', data: {} }, { name: 'TAB_SWITCH', data: {} }, { name: 'TAB_SWITCH', data: {} }],
    meta: { lastFlushAt: Date.UTC(2026, 8, 13, 9, 0, 0), configErrors: [{ field: 'seat', message: 'required' }], lastFlushError: 'ExamEye/x/log.txt: FILE_FAILED', lastError: '2026-09-13T09:00:01.000Z alarms exploded' },
  });
  await tick();
  assert.equal(dom.state.textContent, 'ARMED');
  assert.equal(dom.session.textContent, '20260913-090000_A17');
  assert.notEqual(dom.flush.textContent, 'never');
  assert.deepEqual(dom.errors.textContent.split('\n'), ['seat: required', 'flush: ExamEye/x/log.txt: FILE_FAILED', 'last error: 2026-09-13T09:00:01.000Z alarms exploded']);
  assert.equal(dom.counts.textContent, 'SESSION_ARMED: 1\nTAB_SWITCH: 2');
});
