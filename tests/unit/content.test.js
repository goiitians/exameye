import { test } from 'node:test';
import assert from 'node:assert/strict';

const L = {};
globalThis.document = { addEventListener: (n, f) => { L['doc:' + n] = f; }, hidden: false, fullscreenElement: null };
globalThis.window = { addEventListener: (n, f) => { L['win:' + n] = f; }, outerWidth: 1000, innerWidth: 1000, outerHeight: 800, innerHeight: 700 };
globalThis.getSelection = () => 'abc';
const sent = [];
globalThis.chrome = { runtime: { sendMessage: (m, cb) => { sent.push(m); cb(); }, lastError: undefined } };
await import('../../src/content.js');
const last = () => sent.at(-1);

test('clipboard events report lengths only', () => {
  L['doc:copy']({});
  assert.deepEqual(last(), { type: 'cs', name: 'COPY', data: { len: 3 } });
  L['doc:cut']({});
  assert.equal(last().name, 'CUT');
  L['doc:paste']({ clipboardData: { getData: () => 'hello world' } });
  assert.deepEqual(last(), { type: 'cs', name: 'PASTE', data: { len: 11 } });
});

test('contextmenu, print, visibility, blur, focus', () => {
  L['doc:contextmenu']({ target: { tagName: 'TEXTAREA' } });
  assert.deepEqual(last(), { type: 'cs', name: 'CONTEXTMENU', data: { tag: 'TEXTAREA' } });
  L['win:beforeprint']();
  assert.equal(last().name, 'PRINT');
  document.hidden = true; L['doc:visibilitychange']();
  assert.deepEqual(last(), { type: 'cs', name: 'VISIBILITY', data: { hidden: true } });
  L['win:blur'](); assert.equal(last().name, 'BLUR');
  L['win:focus'](); assert.equal(last().name, 'FOCUS');
});

test('fullscreen exit only after having been fullscreen', () => {
  const n = sent.length;
  L['doc:fullscreenchange']();
  assert.equal(sent.length, n);
  document.fullscreenElement = {}; L['doc:fullscreenchange']();
  document.fullscreenElement = null; L['doc:fullscreenchange']();
  assert.equal(last().name, 'FULLSCREEN_EXIT');
  assert.equal(sent.length, n + 1);
});

test('devtools heuristic fires once per opening', () => {
  const n = sent.length;
  window.outerWidth = 1300; L['win:resize']();
  assert.deepEqual(last(), { type: 'cs', name: 'DEVTOOLS', data: { dw: 300, dh: 100 } });
  L['win:resize']();
  assert.equal(sent.length, n + 1);
  window.outerWidth = 1000; L['win:resize']();
  window.outerWidth = 1300; L['win:resize']();
  assert.equal(sent.length, n + 2);
});
