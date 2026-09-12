import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalize, validate, effectiveExamPrefix, resolved } from '../../src/core/config.js';

const good = { startPrefix: 'https://exam.example.com/start', examPrefix: '', resultPrefix: 'https://exam.example.com/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10 };

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
