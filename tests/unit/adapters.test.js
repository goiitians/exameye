import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.js';

const chrome = installFakeChrome();
const storage = await import('../../src/adapters/storage.js');
const alarms = await import('../../src/adapters/alarms.js');
const { captureJpeg } = await import('../../src/adapters/capture.js');
const dl = await import('../../src/adapters/downloads.js');
const { registerExamScript } = await import('../../src/adapters/scripting.js');
const tabs = await import('../../src/adapters/tabs.js');
const windows = await import('../../src/adapters/windows.js');
const desktop = await import('../../src/adapters/desktop.js');

test('storage.patchMeta merges', async () => {
  await storage.set({ meta: { a: 1 } });
  await storage.patchMeta({ b: 2 });
  assert.deepEqual((await storage.get('meta')).meta, { a: 1, b: 2 });
});

test('alarms', async () => {
  await alarms.setPeriodic('tick', 0.5);
  await alarms.setAt('abandon', 123);
  assert.deepEqual(chrome.alarms.alarms, { tick: { periodInMinutes: 0.5 }, abandon: { when: 123 } });
  await alarms.clear('abandon');
  assert.deepEqual(Object.keys(chrome.alarms.alarms), ['tick']);
});

test('captureJpeg strips the data: prefix', async () => {
  assert.equal(await captureJpeg(3), '/9j/FAKE');
});

test('downloads: writeFile options, suppressUi, erase own completed items only', async () => {
  const id = await dl.writeFile('ExamEye/S/log.txt', 'data:text/plain;base64,YQ==');
  assert.deepEqual(chrome.downloads.calls[0], { url: 'data:text/plain;base64,YQ==', filename: 'ExamEye/S/log.txt', conflictAction: 'overwrite', saveAs: false });
  await dl.suppressUi();
  assert.deepEqual(chrome.downloads.uiOptions, { enabled: false });
  dl.eraseOwnCompleted();
  chrome.downloads.items = [{ id, byExtensionId: 'fake-ext-id' }, { id: 99, byExtensionId: 'other' }];
  await chrome.downloads.onChanged.emit({ id, state: { current: 'complete' } });
  await chrome.downloads.onChanged.emit({ id: 99, state: { current: 'complete' } });
  await chrome.downloads.onChanged.emit({ id, state: { current: 'in_progress' } });
  assert.deepEqual(chrome.downloads.erased, [id]);
});

test('writeFile settles even if the terminal onChanged event arrives before download() resolves with the id', async () => {
  const id = chrome.downloads.nextId;
  const realDownload = chrome.downloads.download.bind(chrome.downloads);
  chrome.downloads.download = async (opts) => {
    // unlike the fake's normal (and real Chrome's typical) ordering, fire the terminal event
    // BEFORE this call's own promise resolves with the id.
    await chrome.downloads.onChanged.emit({ id, state: { current: 'complete' } });
    chrome.downloads.calls.push(opts);
    chrome.downloads.nextId++;
    return id;
  };
  try {
    await assert.doesNotReject(() => dl.writeFile('ExamEye/S/early.txt', 'data:text/plain;base64,YQ=='));
  } finally {
    chrome.downloads.download = realDownload;
  }
});

test('suppressUi resolves when downloads.setUiOptions is undefined', async () => {
  const original = chrome.downloads.setUiOptions;
  chrome.downloads.setUiOptions = undefined;
  try {
    await assert.doesNotReject(() => dl.suppressUi());
  } finally {
    chrome.downloads.setUiOptions = original;
  }
});

test('suppressUi resolves when downloads.setUiOptions rejects (Edge behaviour)', async () => {
  const original = chrome.downloads.setUiOptions;
  chrome.downloads.setUiOptions = async () => { throw new Error('downloads.ui not supported'); };
  try {
    await assert.doesNotReject(() => dl.suppressUi());
  } finally {
    chrome.downloads.setUiOptions = original;
  }
});

test('registerExamScript registers deduplicated match patterns', async () => {
  const cfg = { startPrefix: 'https://e.x/start?x=1', examPrefix: 'https://e.x/' };
  await registerExamScript(cfg);
  await registerExamScript({ startPrefix: 'https://e.x/', examPrefix: 'https://e.x/' });
  assert.equal(chrome.scripting.registered.length, 1);
  assert.deepEqual(chrome.scripting.registered[0], { id: 'exam', js: ['src/content.js'], matches: ['https://e.x/*'], runAt: 'document_start', allFrames: false, persistAcrossSessions: true });
});

test('unregistering an unknown script id rejects', async () => {
  await assert.rejects(() => chrome.scripting.unregisterContentScripts({ ids: ['nope'] }), /Nonexistent script ID/);
});

test('tabs and windows return null instead of throwing', async () => {
  chrome.tabs.list = [{ id: 1, windowId: 3, url: 'u' }];
  chrome.windows.list = [{ id: 3, focused: false, state: 'normal' }];
  assert.equal((await tabs.getTab(1)).id, 1);
  assert.equal(await tabs.getTab(2), null);
  assert.equal((await tabs.queryAllTabs()).length, 1);
  assert.equal((await windows.getWindow(3)).state, 'normal');
  assert.equal(await windows.getWindow(4), null);
  assert.equal(await windows.focusedWindowId(), -1);
  assert.equal(await windows.lastFocusedWindowId(), 3);
  chrome.windows.list[0].focused = true;
  assert.equal(await windows.focusedWindowId(), 3);
});

test('supported reflects chrome.desktopCapture', () => {
  delete chrome.desktopCapture;
  assert.equal(desktop.supported(), false);
  chrome.desktopCapture = {};
  assert.equal(desktop.supported(), true);
  delete chrome.desktopCapture;
});

test('openHolder creates a focused 460x140 popup at the holder URL', async () => {
  const realCreate = chrome.windows.create.bind(chrome.windows);
  const calls = [];
  chrome.windows.create = async (opts) => { calls.push(opts); return realCreate(opts); };
  try {
    const win = await desktop.openHolder();
    assert.deepEqual(calls[0], { url: chrome.runtime.getURL('src/holder/holder.html'), type: 'popup', width: 460, height: 140, focused: true });
    assert.equal(chrome.windows.list.find(w => w.id === win.windowId).type, 'popup');
  } finally { chrome.windows.create = realCreate; }
});

test('grabDesktop falls back to not-alive when nobody answers', async () => {
  chrome.tabs.responder = null;
  assert.deepEqual(await desktop.grabDesktop(9), { b64: null, alive: false });
});

test('setAway and askHolder send holder messages', async () => {
  chrome.tabs.sent = [];
  chrome.tabs.responder = () => ({ ok: true });
  await desktop.setAway(9, true);
  await desktop.askHolder(9);
  assert.deepEqual(chrome.tabs.sent[0], { tabId: 9, msg: { type: 'holder', name: 'away', on: true } });
  assert.deepEqual(chrome.tabs.sent[1], { tabId: 9, msg: { type: 'holder', name: 'ask' } });
  chrome.tabs.responder = null;
});

test('showWindow restores and focuses; minimizeWindow minimises; closeWindow removes and swallows a missing id', async () => {
  const win = await desktop.openHolder();
  await desktop.minimizeWindow(win.windowId);
  assert.equal(chrome.windows.list.find(w => w.id === win.windowId).state, 'minimized');
  await desktop.showWindow(win.windowId);
  const w = chrome.windows.list.find(w => w.id === win.windowId);
  assert.equal(w.state, 'normal');
  assert.equal(w.focused, true);
  await desktop.closeWindow(win.windowId);
  assert.equal(chrome.windows.list.find(w => w.id === win.windowId), undefined);
  await assert.doesNotReject(() => desktop.closeWindow(999999));
});
