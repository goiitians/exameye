import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.js';

const chrome = installFakeChrome();
const config = { startPrefix: 'https://e.x/start', examPrefix: '', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10 };
await chrome.storage.local.set({ config });
const sw = await import('../../src/sw.js');
chrome.windows.list = [{ id: 3, focused: true, state: 'normal' }];
const get = (k) => chrome.storage.local.get(k);
const names = async () => (await get('events')).events.map(e => e.name);

test('browser restart: a restored exam tab committing before recover() runs is not a PARALLEL_PAGE', async () => {
  chrome.tabs.list = [{ id: 1, windowId: 3, url: 'https://e.x/start', title: 'Exam', incognito: false, active: true }];
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start', at: Date.now() - 200000 });
  assert.equal((await get('session')).session.examTabId, 1);
  // Chrome restores the tab under a new id and its onCommitted fires while onStartup's boot() is still awaiting.
  chrome.tabs.list = [{ id: 44, windowId: 9, url: 'https://e.x/start', title: 'Exam', incognito: false, active: true }];
  chrome.windows.list = [{ id: 9, focused: true, state: 'normal' }];
  chrome.runtime.onStartup.emit();
  chrome.webNavigation.onCommitted.emit({ tabId: 44, frameId: 0, url: 'https://e.x/start' });
  await new Promise((r) => setTimeout(r, 50));
  await sw.settled();
  const n = await names();
  assert.ok(!n.includes('PARALLEL_PAGE'), `unexpected PARALLEL_PAGE in ${n}`);
  const gap = (await get('events')).events.find(e => e.name === 'EXTENSION_GAP');
  assert.equal(gap?.data.reason, 'browser-restart');
  assert.equal((await get('session')).session.examTabId, 44);
});

test('a queued step that throws records meta.lastError and does not poison later steps', async () => {
  const realClear = chrome.alarms.clear;
  chrome.alarms.clear = async () => { throw new Error('alarms exploded'); };
  const errors = [];
  const realError = console.error;
  console.error = (...a) => errors.push(a);
  try {
    await sw.dispatch({ kind: 'NAV', tabId: 44, windowId: 9, url: 'https://e.x/q/1', at: Date.now() });
    await sw.dispatch({ kind: 'NAV', tabId: 44, windowId: 9, url: 'https://e.x/result', at: Date.now() });
    await sw.dispatch({ kind: 'NAV', tabId: 44, windowId: 9, url: 'https://e.x/start', at: Date.now() });
  } finally { chrome.alarms.clear = realClear; console.error = realError; }
  assert.match((await get('meta')).meta.lastError, /alarms exploded/);
  assert.equal(errors.length, 1);
  await sw.dispatch({ kind: 'NAV', tabId: 44, windowId: 9, url: 'https://e.x/q/2', at: Date.now() });
  assert.equal((await names()).at(-1), 'EXAM_NAV');
});

test('arming a new session clears the previous lastError so the popup starts clean', async () => {
  assert.ok((await get('meta')).meta.lastError);
  await sw.dispatch({ kind: 'NAV', tabId: 44, windowId: 9, url: 'https://e.x/result', at: Date.now() });
  await sw.dispatch({ kind: 'NAV', tabId: 44, windowId: 9, url: 'https://e.x/start', at: Date.now() });
  assert.equal((await get('meta')).meta.lastError, null);
});
