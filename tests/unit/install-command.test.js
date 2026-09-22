import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, cp, readFile, writeFile, chmod, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SKIP = process.platform !== 'darwin';

const SHIM = `#!/bin/bash
exit 0
`;

const MV_FAIL_ON_NEW = `#!/bin/bash
for a in "$@"; do
  case "$a" in
    */ExamEye.new) exit 1 ;;
  esac
done
exec /bin/mv "$@"
`;

async function buildFixture() {
  const base = await mkdtemp(path.join(os.tmpdir(), 'exameye-install-'));
  const installerDir = path.join(base, 'installer');
  const shimDir = path.join(base, 'shim');
  const home = path.join(base, 'home');
  await mkdir(installerDir, { recursive: true });
  await mkdir(shimDir, { recursive: true });
  await mkdir(home, { recursive: true });
  await cp(path.join(ROOT, 'installer/Install-ExamEye.command'), path.join(installerDir, 'Install-ExamEye.command'));
  await cp(path.join(ROOT, 'installer/update-exameye.sh'), path.join(installerDir, 'update-exameye.sh'));
  const extDir = path.join(installerDir, 'ExamEye');
  await mkdir(path.join(extDir, 'src/popup'), { recursive: true });
  await mkdir(path.join(extDir, 'src/options'), { recursive: true });
  await cp(path.join(ROOT, 'manifest.json'), path.join(extDir, 'manifest.json'));
  await cp(path.join(ROOT, 'installer/defaults.json'), path.join(extDir, 'defaults.json'));
  await cp(path.join(ROOT, 'src/sw.js'), path.join(extDir, 'src/sw.js'));
  await cp(path.join(ROOT, 'src/popup/popup.html'), path.join(extDir, 'src/popup/popup.html'));
  await cp(path.join(ROOT, 'src/options/options.html'), path.join(extDir, 'src/options/options.html'));
  for (const name of ['open', 'pbcopy', 'launchctl', 'pgrep']) {
    const p = path.join(shimDir, name);
    await writeFile(p, SHIM);
    await chmod(p, 0o755);
  }
  return { base, installerDir, shimDir, home, extDir };
}

function runInstaller({ installerDir, shimDir, home }, script, seat) {
  return spawnSync('bash', [script], {
    cwd: installerDir,
    input: `${seat}\n`,
    env: { ...process.env, HOME: home, PATH: `${shimDir}:${process.env.PATH}` },
    encoding: 'utf8',
  });
}

async function readSeat(defaultsPath) {
  const text = await readFile(defaultsPath, 'utf8');
  const m = text.match(/"seat":\s*"([^"]*)"/);
  return m ? m[1] : null;
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

test('macOS installer stages into ExamEye.new and swaps, never deleting first', { skip: SKIP }, async (t) => {
  const fx = await buildFixture();
  const script = path.join(fx.installerDir, 'Install-ExamEye.command');

  const first = runInstaller(fx, script, 'A07');
  assert.equal(first.status, 0, first.stderr);
  const destManifest = path.join(fx.home, 'ExamEye/manifest.json');
  assert.equal(await readSeat(path.join(fx.home, 'ExamEye/defaults.json')), 'A07');
  assert.ok(await exists(path.join(fx.home, 'ExamEye/src/sw.js')));
  assert.equal(await exists(path.join(fx.home, 'ExamEye.new')), false);

  const manifest = JSON.parse(await readFile(destManifest, 'utf8'));
  const bumped = { ...manifest, version: '99.0.0' };
  await writeFile(path.join(fx.extDir, 'manifest.json'), JSON.stringify(bumped));

  const updaterLog = path.join(fx.home, 'ExamEye-updater/update.log');
  await mkdir(path.dirname(updaterLog), { recursive: true });
  await writeFile(updaterLog, 'existing log line\n');

  // a browser is running (pgrep shim) but no marker exists yet: still a plain reinstall
  const second = runInstaller(fx, script, 'B02');
  assert.equal(second.status, 0, `${second.stdout}${second.stderr}`);
  const afterSecond = JSON.parse(await readFile(destManifest, 'utf8'));
  assert.equal(afterSecond.version, '99.0.0');
  assert.equal(await readSeat(path.join(fx.home, 'ExamEye/defaults.json')), 'B02');
  assert.equal(await exists(path.join(fx.home, 'ExamEye.new')), false);
  assert.equal(await exists(path.join(fx.home, 'ExamEye.old')), false);
  assert.equal(await readFile(updaterLog, 'utf8'), 'existing log line\n', 'update.log survives a reinstall');

  await mkdir(path.join(fx.home, 'Downloads/ExamEye-updater'), { recursive: true });
  const statePath = path.join(fx.home, 'Downloads/ExamEye-updater/state.txt');
  await writeFile(statePath, 'ARMED\n');
  const third = runInstaller(fx, script, 'C03');
  assert.notEqual(third.status, 0);
  assert.ok(third.stdout.includes('An exam is running'));
  assert.equal(await exists(path.join(fx.home, 'ExamEye.new')), false);
  const afterThird = JSON.parse(await readFile(destManifest, 'utf8'));
  assert.equal(afterThird.version, '99.0.0', 'an exam in progress must not have its files swapped');
  assert.equal(await readSeat(path.join(fx.home, 'ExamEye/defaults.json')), 'B02', 'seat unchanged while an exam is running');

  await writeFile(statePath, 'CLOSING\n');
  const fourth = runInstaller(fx, script, 'D04');
  assert.notEqual(fourth.status, 0);
  assert.ok(fourth.stdout.includes('An exam is running'));
  assert.equal(await exists(path.join(fx.home, 'ExamEye.new')), false);
  const afterFourth = JSON.parse(await readFile(destManifest, 'utf8'));
  assert.equal(afterFourth.version, '99.0.0', 'an exam in progress must not have its files swapped');
  assert.equal(await readSeat(path.join(fx.home, 'ExamEye/defaults.json')), 'B02', 'seat unchanged while an exam is running');

  await writeFile(statePath, 'IDLE\n');
  const mvShim = path.join(fx.shimDir, 'mv');
  await writeFile(mvShim, MV_FAIL_ON_NEW);
  await chmod(mvShim, 0o755);
  const fifth = runInstaller(fx, script, 'E05');
  assert.notEqual(fifth.status, 0);
  assert.ok(fifth.stdout.includes('in use'));
  const afterFifth = JSON.parse(await readFile(destManifest, 'utf8'));
  assert.equal(afterFifth.version, '99.0.0', 'a failed swap must not lose the previous install');
  assert.equal(await readSeat(path.join(fx.home, 'ExamEye/defaults.json')), 'B02', 'seat unchanged after a failed swap');
  assert.equal(await exists(path.join(fx.home, 'ExamEye.old')), false, 'no .old left after a failed swap');
  await rm(mvShim);
});
