import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const flush = () => new Promise((r) => setTimeout(r, 0));

function makeStream() {
  const listeners = {};
  const track = {
    addEventListener: (name, f) => { listeners[name] = f; },
    stop: () => { track.stop.calls++; },
  };
  track.stop.calls = 0;
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
  return { stream, track, fireEnded: () => listeners.ended?.() };
}

let caseId = 0;
async function loadHolder({ readyResponse } = {}) {
  const dom = {
    v: { videoWidth: 1920, videoHeight: 1080, onloadedmetadata: null },
    c: { width: 0, height: 0, getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/jpeg;base64,QUJD' },
    msg: { textContent: '' },
  };
  const sent = [];
  const chooseCalls = [];
  const gum = { calls: [], resolve: null, reject: null };
  let holderListener = null;
  globalThis.document = { getElementById: (id) => dom[id] };
  const win = { close: () => { win.close.calls++; } };
  win.close.calls = 0;
  globalThis.window = win;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: (constraints) => {
          gum.calls.push(constraints);
          return new Promise((res, rej) => { gum.resolve = res; gum.reject = rej; });
        },
      },
    },
  });
  globalThis.chrome = {
    runtime: {
      sendMessage: (m) => { sent.push(m); return Promise.resolve(m.name === 'ready' ? readyResponse : undefined); },
      onMessage: { addListener: (f) => { holderListener = f; } },
    },
    desktopCapture: {
      chooseDesktopMedia: (sources, cb) => chooseCalls.push({ sources, cb }),
    },
  };
  await import(`../../src/holder/holder.js?case=${caseId++}`);
  await flush();
  return { dom, sent, chooseCalls, gum, win, getListener: () => holderListener };
}

test('holder.html has the three ids, a module script and no core import', () => {
  const html = readFileSync(new URL('../../src/holder/holder.html', import.meta.url), 'utf8');
  assert.match(html, /id="v"/);
  assert.match(html, /id="c"/);
  assert.match(html, /id="msg"/);
  assert.match(html, /<script type="module" src="holder\.js">/);
  const js = readFileSync(new URL('../../src/holder/holder.js', import.meta.url), 'utf8');
  assert.ok(!/from\s+['"].*\/core\//.test(js), 'holder.js must not import from core/');
});

test('sends ready on load; ask:true opens the dialog for screen only; close:true closes the window', async () => {
  const h1 = await loadHolder({ readyResponse: { ask: true } });
  assert.deepEqual(h1.sent[0], { type: 'desktop', name: 'ready' });
  assert.equal(h1.chooseCalls.length, 1);
  assert.deepEqual(h1.chooseCalls[0].sources, ['screen']);

  const h2 = await loadHolder({ readyResponse: { close: true } });
  assert.equal(h2.win.close.calls, 1);
});

test('cancel sends cancelled with pickMs', async () => {
  const h = await loadHolder({ readyResponse: { ask: true } });
  h.chooseCalls[0].cb('');
  const cancelled = h.sent.find(m => m.name === 'cancelled');
  assert.ok(cancelled);
  assert.equal(typeof cancelled.pickMs, 'number');
  assert.match(h.dom.msg.textContent, /not started/i);
});

test('holder.html tells the candidate to click the screen preview, then Share', async () => {
  const html = readFileSync(new URL('../../src/holder/holder.html', import.meta.url), 'utf8');
  assert.match(html, /click the screen preview, then <b>Share<\/b>/i);
});

test('the stream id is consumed by getUserMedia with chromeMediaSource desktop; started carries width/height', async () => {
  const h = await loadHolder({ readyResponse: { ask: true } });
  h.chooseCalls[0].cb('sid-1');
  assert.equal(h.gum.calls.length, 1);
  assert.equal(h.gum.calls[0].video.mandatory.chromeMediaSourceId, 'sid-1');
  assert.equal(h.gum.calls[0].video.mandatory.chromeMediaSource, 'desktop');
  const { stream } = makeStream();
  h.gum.resolve(stream);
  await flush();
  h.dom.v.onloadedmetadata();
  await flush();
  const started = h.sent.find(m => m.name === 'started');
  assert.ok(started);
  assert.match(h.dom.msg.textContent, /recording/i);
  assert.equal(started.width, 1920);
  assert.equal(started.height, 1080);
});

test('grab answers b64 and alive; no stream → b64 null, alive false', async () => {
  const h = await loadHolder({ readyResponse: { ask: true } });
  let resp;
  h.getListener()({ type: 'holder', name: 'grab' }, {}, (r) => { resp = r; });
  assert.deepEqual(resp, { b64: null, alive: false });

  h.chooseCalls[0].cb('sid-1');
  const { stream } = makeStream();
  h.gum.resolve(stream);
  await flush();
  h.dom.v.onloadedmetadata();
  await flush();

  h.getListener()({ type: 'holder', name: 'grab' }, {}, (r) => { resp = r; });
  assert.equal(resp.alive, true);
  assert.equal(resp.b64, 'QUJD');
});

test('away on posts a frame every 10 s; away off stops it', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const h = await loadHolder({ readyResponse: { ask: true } });
  h.chooseCalls[0].cb('sid-1');
  const { stream } = makeStream();
  h.gum.resolve(stream);
  await flush();
  h.dom.v.onloadedmetadata();
  await flush();
  h.sent.length = 0;
  h.getListener()({ type: 'holder', name: 'away', on: true }, {}, () => {});
  t.mock.timers.tick(10000);
  t.mock.timers.tick(10000);
  assert.equal(h.sent.filter(m => m.name === 'frame').length, 2);
  h.getListener()({ type: 'holder', name: 'away', on: false }, {}, () => {});
  t.mock.timers.tick(10000);
  assert.equal(h.sent.filter(m => m.name === 'frame').length, 2);
});

test('track ended sends ended and stops the away loop', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const h = await loadHolder({ readyResponse: { ask: true } });
  h.chooseCalls[0].cb('sid-1');
  const { stream, fireEnded } = makeStream();
  h.gum.resolve(stream);
  await flush();
  h.dom.v.onloadedmetadata();
  await flush();
  h.getListener()({ type: 'holder', name: 'away', on: true }, {}, () => {});
  fireEnded();
  assert.ok(h.sent.some(m => m.name === 'ended'));
  h.sent.length = 0;
  t.mock.timers.tick(10000);
  assert.equal(h.sent.filter(m => m.name === 'frame').length, 0);
});

test('ask message stops the current stream and re-asks', async () => {
  const h = await loadHolder({ readyResponse: { ask: true } });
  h.chooseCalls[0].cb('sid-1');
  const { stream, track } = makeStream();
  h.gum.resolve(stream);
  await flush();
  h.dom.v.onloadedmetadata();
  await flush();
  h.getListener()({ type: 'holder', name: 'ask' }, {}, () => {});
  assert.equal(h.chooseCalls.length, 2);
  assert.equal(track.stop.calls, 1);
});
