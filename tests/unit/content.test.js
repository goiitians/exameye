import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LABEL_VECTORS } from '../../src/core/labels.js';

const L = {};
globalThis.document = {
  addEventListener: (n, f) => { L['doc:' + n] = f; },
  hidden: false, fullscreenElement: null,
  documentElement: {},
  body: { innerText: '' },
};
globalThis.window = { addEventListener: (n, f) => { L['win:' + n] = f; }, outerWidth: 1000, innerWidth: 1000, outerHeight: 800, innerHeight: 700 };
globalThis.getSelection = () => 'abc';
const sent = [];
const storageGetCalls = [];
globalThis.chrome = {
  runtime: { sendMessage: (m, cb) => { sent.push(m); cb(); }, lastError: undefined },
  storage: {
    local: { get: async (k) => { storageGetCalls.push(k); return { config: {} }; } },
    onChanged: { addListener: (f) => { L['storage'] = f; } },
  },
};
class FakeObserver {
  constructor(cb) { this.cb = cb; }
  observe(target, opts) { this.target = target; this.opts = opts; FakeObserver.last = this; }
  trigger() { this.cb(); }
}
globalThis.MutationObserver = FakeObserver;
await import('../../src/content.js');
const last = () => sent.at(-1);
const setConfig = (cfg) => L['storage']({ config: { newValue: cfg } }, 'local');

test('normaliser matches core/labels on the shared vectors', () => {
  for (const [raw, expected] of LABEL_VECTORS) {
    if (!expected) continue;
    setConfig({ endButton: expected });
    const n = sent.length;
    L['doc:click']({ target: { closest: () => ({ innerText: raw }) } });
    assert.equal(sent.length, n + 1, raw);
    assert.deepEqual(last(), { type: 'cs', name: 'END_CLICK', data: { label: expected } });
  }
  setConfig({ startButton: 'Start', endButton: 'Finish, Confirm submission', endMarker: 'Your answers have been submitted' });
});

test('click on a matching start button sends START_CLICK; end button sends END_CLICK; others send nothing', () => {
  const click = (control) => L['doc:click']({ target: { closest: () => control } });
  click({ innerText: ' Confirm   submission ' });
  assert.deepEqual(last(), { type: 'cs', name: 'END_CLICK', data: { label: 'confirm submission' } });
  let n = sent.length;
  click({ innerText: 'Next' });
  assert.equal(sent.length, n);
  click(null);
  assert.equal(sent.length, n);
  click({ innerText: '', value: 'Finish' });
  assert.deepEqual(last(), { type: 'cs', name: 'END_CLICK', data: { label: 'finish' } });
  click({ innerText: '', value: '', getAttribute: () => 'Start' });
  assert.deepEqual(last(), { type: 'cs', name: 'START_CLICK', data: { label: 'start' } });
});

test('observer is attached to documentElement with childList, characterData, subtree', () => {
  assert.equal(FakeObserver.last.target, document.documentElement);
  assert.deepEqual(FakeObserver.last.opts, { childList: true, characterData: true, subtree: true });
});

test('mutations are debounced to one SCREEN_CHANGED per second', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const n = sent.length;
  FakeObserver.last.trigger();
  FakeObserver.last.trigger();
  FakeObserver.last.trigger();
  t.mock.timers.tick(999);
  assert.equal(sent.length, n);
  t.mock.timers.tick(1);
  assert.equal(sent.length, n + 1);
  assert.equal(last().name, 'SCREEN_CHANGED');
});

test('END_MARKER is sent once when the marker text appears', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  document.body.innerText = 'Thank you.\nYour   answers have been SUBMITTED.';
  FakeObserver.last.trigger();
  t.mock.timers.tick(1000);
  let markers = sent.filter(m => m.name === 'END_MARKER');
  assert.equal(markers.length, 1);
  assert.deepEqual(markers[0], { type: 'cs', name: 'END_MARKER', data: { marker: 'your answers have been submitted' } });
  FakeObserver.last.trigger();
  t.mock.timers.tick(1000);
  assert.equal(sent.filter(m => m.name === 'END_MARKER').length, 1);
  setConfig({ endMarker: '' });
  document.body.innerText = 'Your answers have been submitted.';
  FakeObserver.last.trigger();
  t.mock.timers.tick(1000);
  assert.equal(sent.filter(m => m.name === 'END_MARKER').length, 1);
});

test('a submitted screen already on the page is reported once the config arrives', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  setConfig({ endMarker: '' });
  document.body.innerText = 'Your answers have been submitted.';
  const before = sent.filter(m => m.name === 'END_MARKER').length;
  setConfig({ endMarker: 'Your answers have been submitted' });
  t.mock.timers.tick(1000);
  assert.equal(sent.filter(m => m.name === 'END_MARKER').length, before + 1);
});

test('a mutation every 500 ms still yields one SCREEN_CHANGED within 5 s', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  const count = () => sent.filter(m => m.name === 'SCREEN_CHANGED').length;
  const n = count();
  for (let i = 0; i < 12; i++) { FakeObserver.last.trigger(); t.mock.timers.tick(500); }
  assert.equal(count(), n + 1);
  t.mock.timers.tick(1000);
  assert.equal(count(), n + 2);
});

test('config arrives from storage.local.get at load', () => {
  assert.deepEqual(storageGetCalls, ['config']);
});

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

test('sendMessage throwing synchronously does not throw', () => {
  const realChrome = globalThis.chrome;
  globalThis.chrome = { runtime: { sendMessage: () => { throw new Error('boom'); }, lastError: undefined } };
  assert.doesNotThrow(() => L['doc:copy']({}));
  globalThis.chrome = realChrome;
});

test('missing or undefined chrome.runtime does not throw', () => {
  const realChrome = globalThis.chrome;
  globalThis.chrome = {};
  assert.doesNotThrow(() => L['doc:copy']({}));
  globalThis.chrome = undefined;
  assert.doesNotThrow(() => L['doc:copy']({}));
  globalThis.chrome = realChrome;
});

test('callback invoked after chrome.runtime is torn down does not throw', () => {
  const realChrome = globalThis.chrome;
  let savedCb;
  globalThis.chrome = { runtime: { sendMessage: (m, cb) => { savedCb = cb; }, lastError: undefined } };
  L['doc:copy']({});
  globalThis.chrome = undefined;
  assert.doesNotThrow(() => savedCb());
  globalThis.chrome = realChrome;
});
