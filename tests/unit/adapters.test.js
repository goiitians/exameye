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

test('registerExamScript registers deduplicated match patterns', async () => {
  const cfg = { startPrefix: 'https://e.x/start?x=1', examPrefix: 'https://e.x/' };
  await registerExamScript(cfg);
  await registerExamScript({ startPrefix: 'https://e.x/', examPrefix: 'https://e.x/' });
  assert.equal(chrome.scripting.registered.length, 1);
  assert.deepEqual(chrome.scripting.registered[0], { id: 'exam', js: ['src/content.js'], matches: ['https://e.x/*'], runAt: 'document_start', allFrames: false, persistAcrossSessions: true });
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
