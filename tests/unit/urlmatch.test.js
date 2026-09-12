import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesPrefix, originOf, prefixToMatchPattern, classify } from '../../src/core/urlmatch.js';

const cfg = { startPrefix: 'https://exam.example.com/start', examPrefix: 'https://exam.example.com/', resultPrefix: 'https://exam.example.com/result' };

test('matchesPrefix is a plain starts-with; empty prefix never matches', () => {
  assert.equal(matchesPrefix('https://exam.example.com/start?c=9', 'https://exam.example.com/start'), true);
  assert.equal(matchesPrefix('https://exam.example.com/st', 'https://exam.example.com/start'), false);
  assert.equal(matchesPrefix('https://exam.example.com/x', ''), false);
});

test('originOf keeps scheme, host and port', () => {
  assert.equal(originOf('http://127.0.0.1:8080/exam/start.html'), 'http://127.0.0.1:8080/');
  assert.equal(originOf('https://exam.example.com/start?x=1'), 'https://exam.example.com/');
});

test('prefixToMatchPattern drops query/fragment and appends *', () => {
  assert.equal(prefixToMatchPattern('https://exam.example.com/start?x=1#f'), 'https://exam.example.com/start*');
  assert.equal(prefixToMatchPattern('http://127.0.0.1:8080/'), 'http://127.0.0.1:8080/*');
});

test('classify precedence is result > start > exam', () => {
  assert.equal(classify('https://exam.example.com/result/123', cfg), 'result');
  assert.equal(classify('https://exam.example.com/start?c=1', cfg), 'start');
  assert.equal(classify('https://exam.example.com/q/2', cfg), 'exam');
  assert.equal(classify('https://google.com/', cfg), null);
});
