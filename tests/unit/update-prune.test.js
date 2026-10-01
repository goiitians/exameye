import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, cp, readFile, readdir, writeFile, chmod, symlink, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SKIP = process.platform !== 'darwin';
const SESSIONS = ['20260901-090000_A07', '20260902-090000_A07', '20260903-090000_A07', '20260904-090000_A07',
  '20260905-090000_A07', '20260906-090000_A07', '20260907-090000_A07'];

async function fixture({ chrome = false, state, sessions = SESSIONS, linkDownloads = false, linkRec = false } = {}) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'exameye-prune-'));
  const home = path.join(base, 'home');
  const shim = path.join(base, 'shim');
  const outside = path.join(base, 'outside');
  const dl = linkDownloads ? path.join(base, 'realdl') : path.join(home, 'Downloads');
  const rec = linkRec ? path.join(base, 'realrec') : path.join(dl, 'ExamEye');
  await mkdir(path.join(home, 'ExamEye'), { recursive: true });
  await cp(path.join(ROOT, 'manifest.json'), path.join(home, 'ExamEye/manifest.json'));
  await mkdir(shim, { recursive: true });
  await writeFile(path.join(shim, 'pgrep'), `#!/bin/bash\nexit ${chrome ? 0 : 1}\n`);
  await chmod(path.join(shim, 'pgrep'), 0o755);
  await mkdir(path.join(outside, 'keep'), { recursive: true });
  await writeFile(path.join(outside, 'keep/precious.txt'), 'x');
  for (const s of sessions) {
    await mkdir(path.join(rec, s, 'screenshots'), { recursive: true });
    await writeFile(path.join(rec, s, 'log.txt'), 'x');
    await writeFile(path.join(rec, s, 'screenshots/a.jpg'), 'x');
  }
  await symlink(path.join(outside, 'keep'), path.join(rec, sessions[0], 'link-out'));
  await mkdir(path.join(rec, 'notes'), { recursive: true });
  await writeFile(path.join(rec, '20250101-000000_A07'), 'a file, not a session folder');
  await symlink(path.join(outside, 'keep'), path.join(rec, '20250102-000000_A07'));
  await mkdir(path.join(dl, '20250103-000000_A07'), { recursive: true });
  await mkdir(path.join(dl, 'Other/20250104-000000_A07'), { recursive: true });
  if (linkRec) await symlink(rec, path.join(dl, 'ExamEye'));
  if (linkDownloads) await symlink(dl, path.join(home, 'Downloads'));
  if (state) {
    await mkdir(path.join(dl, 'ExamEye-updater'), { recursive: true });
    await writeFile(path.join(dl, 'ExamEye-updater/state.txt'), `${state}\n`);
  }
  const r = spawnSync('bash', [path.join(ROOT, 'installer/update-exameye.sh')], {
    env: { ...process.env, HOME: home, PATH: `${shim}:${process.env.PATH}`, EXAMEYE_UPDATE_URL: `file://${base}/missing` },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  const log = await readFile(path.join(home, 'ExamEye-updater/update.log'), 'utf8');
  const left = (await readdir(rec)).sort();
  return { home, dl, outside, log, left, kept: left.filter((n) => sessions.includes(n)) };
}

const exists = (p) => stat(p).then(() => true, () => false);

test('updater keeps the newest 5 session folders and touches nothing else', { skip: SKIP }, async () => {
  const fx = await fixture();
  assert.deepEqual(fx.left, ['20250101-000000_A07', '20250102-000000_A07', ...SESSIONS.slice(2), 'notes'].sort());
  assert.match(fx.log, /pruned 20260901-090000_A07/);
  assert.match(fx.log, /pruned 20260902-090000_A07/);
  assert.ok(await exists(path.join(fx.outside, 'keep/precious.txt')), 'link targets outside are untouched');
  assert.ok(await exists(path.join(fx.dl, '20250103-000000_A07')), 'Downloads itself is not pruned');
  assert.ok(await exists(path.join(fx.dl, 'Other/20250104-000000_A07')), 'other Downloads folders are not pruned');
  assert.ok(await exists(path.join(fx.home, 'ExamEye/manifest.json')), 'extension folder is untouched');
});

test('updater deletes nothing when there are 5 or fewer sessions', { skip: SKIP }, async () => {
  const fx = await fixture({ sessions: SESSIONS.slice(2) });
  assert.equal(fx.kept.length, 5);
  assert.doesNotMatch(fx.log, /pruned/);
});

test('updater prunes while the browser is open but ExamEye is IDLE', { skip: SKIP }, async () => {
  const fx = await fixture({ chrome: true, state: 'IDLE' });
  assert.equal(fx.kept.length, 5);
});

test('updater does not prune while an exam is running', { skip: SKIP }, async () => {
  const fx = await fixture({ chrome: true, state: 'RUNNING' });
  assert.equal(fx.kept.length, 7);
  assert.doesNotMatch(fx.log, /pruned/);
});

test('updater does not prune while the browser is open and there is no state file', { skip: SKIP }, async () => {
  const fx = await fixture({ chrome: true });
  assert.equal(fx.kept.length, 7);
});

test('updater does not follow a symlinked Downloads folder', { skip: SKIP }, async () => {
  const fx = await fixture({ linkDownloads: true });
  assert.equal(fx.kept.length, 7);
  assert.doesNotMatch(fx.log, /pruned/);
});

test('updater does not follow a symlinked Downloads/ExamEye folder', { skip: SKIP }, async () => {
  const fx = await fixture({ linkRec: true });
  assert.equal(fx.kept.length, 7);
  assert.doesNotMatch(fx.log, /pruned/);
});
