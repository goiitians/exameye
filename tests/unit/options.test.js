import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULTS } from '../../src/core/config.js';
import { installFakeChrome } from './fake-chrome.js';
import { installFakeDom } from './fake-dom.js';

const chrome = installFakeChrome();
const fields = Object.keys(DEFAULTS);
const dom = installFakeDom(['status', 'dest', 'recording', ...fields.map(k => `err-${k}`)], fields);
const tick = () => new Promise((r) => setTimeout(r, 5));
const html = await readFile(new URL('../../src/options/options.html', import.meta.url), 'utf8');

test('options form has one field per config key, an error slot per field, ok/err status colours and a module script', () => {
  for (const k of fields) {
    assert.match(html, new RegExp(`name="${k}"`), k);
    assert.match(html, new RegExp(`id="err-${k}"`), `error slot for ${k}`);
  }
  assert.match(html, /#status\.ok \{ color: #0/);
  assert.match(html, /#status\.err \{ color: #a00/);
  assert.match(html, /<script type="module" src="options.js"><\/script>/);
  assert.doesNotMatch(html, /<script(?![^>]*src=)/, 'no inline script (extension CSP)');
  assert.match(html, /id="recording"[^>]*hidden/, 'the recording banner starts hidden');
});

test('form has desktopCapture select with on/off values and desktopRepromptMin input', () => {
  assert.match(html, /<select[^>]*name="desktopCapture"[^>]*>[\s\S]*?<option value="on">[\s\S]*?<option value="off">[\s\S]*?<\/select>/);
  assert.match(html, /<input[^>]*name="desktopRepromptMin"[^>]*type="number"[^>]*min="0"[^>]*max="60"/);
});

test('every field has a plain-language help line', () => {
  for (const k of fields) assert.match(html, new RegExp(`name="${k}"[\\s\\S]{0,400}?class="help"`), `help text after ${k}`);
});

test('load fills the form from storage (defaults when nothing saved) and hides the recording banner while IDLE', async () => {
  await import('../../src/options/options.js');
  await tick();
  assert.equal(dom.form.elements.subfolder.value, 'ExamEye');
  assert.equal(dom.form.elements.shotIntervalMin.value, 10);
  assert.equal(dom.dest.textContent, 'Recordings are saved in <Chrome download folder>/ExamEye/<date-time_seat>/');
  assert.equal(dom.recording.hidden, true);
});

test('invalid submit: the message sits under the offending field, the status counts the fields, nothing saved', async () => {
  Object.assign(dom.form.elements.startPrefix, { value: 'https://e.x/start' });
  Object.assign(dom.form.elements.resultPrefix, { value: 'ftp://e.x/result' });
  Object.assign(dom.form.elements.seat, { value: 'A17' });
  await dom.form.submit();
  await tick();
  assert.equal(dom.status.className, 'err');
  assert.equal(dom.status.textContent, 'Fix the 1 highlighted field and save again.');
  assert.equal(dom['err-resultPrefix'].hidden, false);
  assert.match(dom['err-resultPrefix'].textContent, /http\(s\) URL prefix/);
  assert.equal(dom['err-startPrefix'].hidden, true);
  assert.equal((await chrome.storage.local.get('config')).config, undefined);
});

test('valid submit: green Saved., config stored normalised, form re-synced, field errors cleared', async () => {
  Object.assign(dom.form.elements.resultPrefix, { value: '  https://e.x/result  ' });
  Object.assign(dom.form.elements.seat, { value: ' A17 ' });
  Object.assign(dom.form.elements.shotIntervalMin, { value: '5' });
  await dom.form.submit();
  await tick();
  assert.equal(dom.status.className, 'ok');
  assert.equal(dom.status.textContent, 'Saved.');
  assert.equal(dom['err-resultPrefix'].hidden, true);
  assert.equal(dom['err-resultPrefix'].textContent, '');
  const { config } = await chrome.storage.local.get('config');
  assert.equal(config.seat, 'A17');
  assert.equal(config.shotIntervalMin, 5);
  assert.equal(dom.form.elements.seat.value, 'A17');
  assert.equal(dom.form.elements.resultPrefix.value, 'https://e.x/result');
  assert.equal(dom.form.elements.shotIntervalMin.value, 5);
});

test('save round-trips desktopCapture off', async () => {
  Object.assign(dom.form.elements.desktopCapture, { value: 'off' });
  await dom.form.submit();
  await tick();
  assert.equal(dom.status.className, 'ok');
  const { config } = await chrome.storage.local.get('config');
  assert.equal(config.desktopCapture, 'off');
  assert.equal(dom.form.elements.desktopCapture.value, 'off');
});

test('result prefix may be blank and the page saves', async () => {
  Object.assign(dom.form.elements.resultPrefix, { value: '' });
  Object.assign(dom.form.elements.endButton, { value: 'Finish' });
  await dom.form.submit();
  await tick();
  assert.equal(dom.status.className, 'ok');
  assert.equal(dom.status.textContent, 'Saved.');
});

test('validation error lands under endButton when no end trigger is set', async () => {
  Object.assign(dom.form.elements.resultPrefix, { value: '' });
  Object.assign(dom.form.elements.endButton, { value: '' });
  Object.assign(dom.form.elements.endMarker, { value: '' });
  await dom.form.submit();
  await tick();
  assert.equal(dom.status.className, 'err');
  assert.equal(dom['err-endButton'].hidden, false);
  assert.match(dom['err-endButton'].textContent, /set an end button, an end marker, or a result URL prefix/);
});

test('recording banner follows the session: shown while ARMED or CLOSING, hidden again when IDLE', async () => {
  await chrome.storage.local.set({ session: { state: 'ARMED', id: '20260101-000000_A17' } });
  await tick();
  assert.equal(dom.recording.hidden, false);
  await chrome.storage.local.set({ session: { state: 'CLOSING', id: '20260101-000000_A17' } });
  await tick();
  assert.equal(dom.recording.hidden, false);
  await chrome.storage.local.set({ session: { state: 'IDLE' } });
  await tick();
  assert.equal(dom.recording.hidden, true);
});
