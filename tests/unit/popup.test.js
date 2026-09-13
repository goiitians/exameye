import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { installFakeChrome } from './fake-chrome.js';
import { installFakeDom } from './fake-dom.js';

const chrome = installFakeChrome();
const dom = installFakeDom(['state', 'session', 'flush', 'errors', 'counts']);
const tick = () => new Promise((r) => setTimeout(r, 5));

test('popup has the live-state slots and a module script', async () => {
  const html = await readFile(new URL('../../src/popup/popup.html', import.meta.url), 'utf8');
  for (const id of ['state', 'session', 'flush', 'errors', 'counts']) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /<script type="module" src="popup.js"><\/script>/);
});

test('render: idle with nothing stored', async () => {
  await import('../../src/popup/popup.js');
  await tick();
  assert.equal(dom.state.textContent, 'IDLE');
  assert.equal(dom.session.textContent, '-');
  assert.equal(dom.flush.textContent, 'never');
  assert.equal(dom.errors.textContent, '-');
  assert.equal(dom.counts.textContent, '(no events)');
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
