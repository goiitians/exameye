import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULTS } from '../../src/core/config.js';
import { installFakeChrome } from './fake-chrome.js';
import { installFakeDom } from './fake-dom.js';

const chrome = installFakeChrome();
const fields = Object.keys(DEFAULTS);
const dom = installFakeDom(['status', 'dest'], fields);
const tick = () => new Promise((r) => setTimeout(r, 5));

test('options form has one field per config key, ok/err status colours and a module script', async () => {
  const html = await readFile(new URL('../../src/options/options.html', import.meta.url), 'utf8');
  // desktopCapture/desktopRepromptMin get their <input> fields in Task 7 (desktop-capture-plan.md).
  for (const k of fields.filter(k => k !== 'desktopCapture' && k !== 'desktopRepromptMin')) assert.match(html, new RegExp(`name="${k}"`), k);
  assert.match(html, /#status\.ok \{ color: #0/);
  assert.match(html, /#status\.err \{ color: #a00/);
  assert.match(html, /<script type="module" src="options.js"><\/script>/);
});

test('load fills the form from storage (defaults when nothing saved)', async () => {
  await import('../../src/options/options.js');
  await tick();
  assert.equal(dom.form.elements.subfolder.value, 'ExamEye');
  assert.equal(dom.form.elements.shotIntervalMin.value, 10);
  assert.equal(dom.dest.textContent, 'Files land in: <Chrome download directory>/ExamEye/');
});

test('invalid submit: red status naming the field, nothing saved', async () => {
  Object.assign(dom.form.elements.startPrefix, { value: 'https://e.x/start' });
  Object.assign(dom.form.elements.resultPrefix, { value: 'ftp://e.x/result' });
  Object.assign(dom.form.elements.seat, { value: 'A17' });
  await dom.form.submit();
  await tick();
  assert.equal(dom.status.className, 'err');
  assert.match(dom.status.textContent, /^resultPrefix: /);
  assert.equal((await chrome.storage.local.get('config')).config, undefined);
});

test('valid submit: green Saved., config stored normalised, form re-synced to what was saved', async () => {
  Object.assign(dom.form.elements.resultPrefix, { value: '  https://e.x/result  ' });
  Object.assign(dom.form.elements.seat, { value: ' A17 ' });
  Object.assign(dom.form.elements.shotIntervalMin, { value: '5' });
  await dom.form.submit();
  await tick();
  assert.equal(dom.status.className, 'ok');
  assert.equal(dom.status.textContent, 'Saved.');
  const { config } = await chrome.storage.local.get('config');
  assert.equal(config.seat, 'A17');
  assert.equal(config.shotIntervalMin, 5);
  assert.equal(dom.form.elements.seat.value, 'A17');
  assert.equal(dom.form.elements.resultPrefix.value, 'https://e.x/result');
  assert.equal(dom.form.elements.shotIntervalMin.value, 5);
});

test('result prefix may be blank and the page saves', async () => {
  Object.assign(dom.form.elements.resultPrefix, { value: '' });
  Object.assign(dom.form.elements.endButton, { value: 'Finish' });
  await dom.form.submit();
  await tick();
  assert.equal(dom.status.className, 'ok');
  assert.equal(dom.status.textContent, 'Saved.');
});

test('validation error names endButton when no end trigger is set', async () => {
  Object.assign(dom.form.elements.resultPrefix, { value: '' });
  Object.assign(dom.form.elements.endButton, { value: '' });
  Object.assign(dom.form.elements.endMarker, { value: '' });
  await dom.form.submit();
  await tick();
  assert.equal(dom.status.className, 'err');
  assert.match(dom.status.textContent, /^endButton: /);
});
