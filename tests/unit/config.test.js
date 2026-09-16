import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalize, validate, effectiveExamPrefix, resolved, changedKeys } from '../../src/core/config.js';

const good = { startPrefix: 'https://exam.example.com/start', examPrefix: '', resultPrefix: 'https://exam.example.com/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10, startButton: '', endButton: '', endMarker: '', maxMin: 0, tailMin: 5, desktopCapture: 'on', desktopRepromptMin: 5 };

test('normalize merges defaults, trims strings, coerces numbers', () => {
  const cfg = normalize({ startPrefix: '  https://x.example/s ', shotIntervalMin: '5' });
  assert.equal(cfg.startPrefix, 'https://x.example/s');
  assert.equal(cfg.shotIntervalMin, 5);
  assert.equal(cfg.subfolder, DEFAULTS.subfolder);
  assert.equal(cfg.abandonMin, 10);
});

test('validate returns [] for a good config', () => {
  assert.deepEqual(validate(good), []);
});

test('validate names each bad field', () => {
  const errors = validate({ ...good, startPrefix: 'ftp://x', seat: '', subfolder: 'a/b', shotIntervalMin: 0, abandonMin: 500 });
  assert.deepEqual(errors.map(e => e.field), ['startPrefix', 'seat', 'subfolder', 'shotIntervalMin', 'abandonMin']);
});

test('examPrefix may be blank but not garbage', () => {
  assert.deepEqual(validate({ ...good, examPrefix: 'nope' }).map(e => e.field), ['examPrefix']);
});

test('effective exam prefix defaults to the start origin', () => {
  assert.equal(effectiveExamPrefix(good), 'https://exam.example.com/');
  assert.equal(effectiveExamPrefix({ ...good, examPrefix: 'https://exam.example.com/paper/' }), 'https://exam.example.com/paper/');
  assert.equal(resolved(good).examPrefix, 'https://exam.example.com/');
  assert.equal(good.examPrefix, '');
});

test('new fields default: buttons/marker blank, maxMin 0, tailMin 5', () => {
  const cfg = normalize({});
  assert.equal(cfg.startButton, '');
  assert.equal(cfg.endButton, '');
  assert.equal(cfg.endMarker, '');
  assert.equal(cfg.maxMin, 0);
  assert.equal(cfg.tailMin, 5);
  const cfg2 = normalize({ maxMin: '', tailMin: '0' });
  assert.equal(cfg2.maxMin, 0);
  assert.equal(cfg2.tailMin, 0);
});

test('resultPrefix is optional when an end button or marker is set', () => {
  assert.deepEqual(validate({ ...good, resultPrefix: '', endButton: 'Submit' }), []);
  assert.deepEqual(validate({ ...good, resultPrefix: '', endButton: '', endMarker: 'done' }), []);
});

test('at least one end trigger is required', () => {
  const errors = validate({ ...good, resultPrefix: '', endButton: '', endMarker: '' });
  assert.deepEqual(errors.map(e => e.field), ['endButton']);
});

test('startPrefix and resultPrefix must differ', () => {
  const errors = validate({ ...good, resultPrefix: good.startPrefix });
  assert.deepEqual(errors.map(e => e.field), ['resultPrefix']);
});

test('endButton list must yield a label; labels max 80 chars', () => {
  assert.deepEqual(validate({ ...good, endButton: ' , ,' }).map(e => e.field), ['endButton']);
  assert.deepEqual(validate({ ...good, endButton: 'a'.repeat(81) }).map(e => e.field), ['endButton']);
});

test('maxMin 0-600 integer, tailMin 0-60 integer', () => {
  assert.deepEqual(validate({ ...good, maxMin: 601 }).map(e => e.field), ['maxMin']);
  assert.deepEqual(validate({ ...good, tailMin: -1 }).map(e => e.field), ['tailMin']);
  assert.deepEqual(validate({ ...good, tailMin: 1.5 }).map(e => e.field), ['tailMin']);
});

test('desktop fields default on / 5', () => {
  const cfg = normalize({});
  assert.equal(cfg.desktopCapture, 'on');
  assert.equal(cfg.desktopRepromptMin, 5);
  assert.equal(normalize({ desktopRepromptMin: '0' }).desktopRepromptMin, 0);
});

test('desktopCapture must be on or off', () => {
  assert.deepEqual(validate({ ...good, desktopCapture: 'yes' }).map(e => e.field), ['desktopCapture']);
  assert.deepEqual(validate({ ...good, desktopCapture: 'OFF' }).map(e => e.field), ['desktopCapture']);
});

test('desktopRepromptMin integer 0-60', () => {
  assert.deepEqual(validate({ ...good, desktopRepromptMin: -1 }).map(e => e.field), ['desktopRepromptMin']);
  assert.deepEqual(validate({ ...good, desktopRepromptMin: 61 }).map(e => e.field), ['desktopRepromptMin']);
  assert.deepEqual(validate({ ...good, desktopRepromptMin: 2.5 }).map(e => e.field), ['desktopRepromptMin']);
  assert.deepEqual(validate({ ...good, desktopRepromptMin: 0 }), []);
});

test('changedKeys lists the normalised fields that differ, in DEFAULTS order', () => {
  const a = { ...DEFAULTS, startPrefix: 'https://e.x/start', seat: 'A' };
  assert.deepEqual(changedKeys(a, { ...a, tailMin: '2', subfolder: ' ExamEye ' }), ['tailMin']);
  assert.deepEqual(changedKeys(a, { ...a, desktopRepromptMin: 0, seat: 'B' }), ['seat', 'desktopRepromptMin']);
  assert.deepEqual(changedKeys(a, a), []);
  assert.deepEqual(changedKeys(undefined, {}), []);
});
