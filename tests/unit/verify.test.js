import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access, mkdtemp, cp, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { checkSession } from '../../src/core/verify.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const dir = path.join(ROOT, 'tests/fixtures/session-ok');

async function load(folder = dir) {
  const lines = (await readFile(path.join(folder, 'log.txt'), 'utf8')).split('\n');
  if (lines.at(-1) === '') lines.pop();
  const events = (await readFile(path.join(folder, 'events.jsonl'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const exists = (f) => access(path.join(folder, f)).then(() => true, () => false);
  return { lines, events, exists };
}

test('the intact fixture verifies', async () => {
  assert.deepEqual(await checkSession(await load()), { ok: true, problems: [], lines: 3, events: 2, shots: 2 });
});

test('an edited log line breaks the chain at the next line and its event hash', async () => {
  const f = await load();
  f.lines[1] = f.lines[1].replace('trigger="nav"', 'trigger="button"');
  const r = await checkSession(f);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p === 'log chain broken at line 2'), r.problems.join('; '));
  assert.ok(r.problems.some((p) => p.startsWith('event 1 hash ')), r.problems.join('; '));
});

test('a truncated log is a count mismatch', async () => {
  const f = await load();
  f.lines.pop();
  const r = await checkSession(f);
  assert.ok(r.problems.includes('events.jsonl has 2 events, log.txt has 1 lines'), r.problems.join('; '));
});

test('a missing screenshot and an escaping path are reported', async () => {
  const f = await load();
  f.events[1].shot = '../outside.jpg';
  const r = await checkSession({ ...f, exists: async (p) => p !== 'screenshots/20260912-091502_SESSION_ARMED.jpg' });
  assert.ok(r.problems.includes('missing screenshots/20260912-091502_SESSION_ARMED.jpg'), r.problems.join('; '));
  assert.ok(r.problems.includes('unsafe path ../outside.jpg'), r.problems.join('; '));
});

test('CLI: OK exits 0, a tampered copy exits 1 with BROKEN', async () => {
  const out = execFileSync(process.execPath, ['tools/verify.mjs', dir], { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /^OK .*: 3 lines, 2 events, 2 screenshots present\n$/);
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'exameye-verify-'));
  try {
    await cp(dir, tmp, { recursive: true });
    const log = await readFile(path.join(tmp, 'log.txt'), 'utf8');
    await writeFile(path.join(tmp, 'log.txt'), log.replace('TAB_SWITCH', 'TAB_SWITCX'));
    let code = 0, stdout = '';
    try { execFileSync(process.execPath, ['tools/verify.mjs', tmp], { cwd: ROOT, encoding: 'utf8' }); }
    catch (e) { code = e.status; stdout = e.stdout; }
    assert.equal(code, 1);
    assert.match(stdout, /^BROKEN /);
    assert.match(stdout, /event 2 hash /);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
