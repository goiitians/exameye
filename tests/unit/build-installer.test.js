import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');

test('build-installer writes the extension, both updater scripts and a zip into EXAMEYE_DIST', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'exameye-dist-'));
  const out = path.join(base, 'exameye-installer');
  try {
    execFileSync('node', ['tools/build-installer.mjs'], { cwd: ROOT, env: { ...process.env, EXAMEYE_DIST: out }, stdio: 'pipe' });
    const manifest = JSON.parse(await readFile(path.join(out, 'ExamEye/manifest.json'), 'utf8'));
    assert.equal(manifest.name, 'ExamEye');
    const ps1 = await readFile(path.join(out, 'Update-ExamEye.ps1'), 'utf8');
    assert.ok(ps1.startsWith('# ExamEye updater for Windows'));
    assert.ok(!/[^\r]\n/.test(ps1), 'Windows reads the .ps1 with CRLF line endings');
    const sh = await stat(path.join(out, 'update-exameye.sh'));
    assert.ok(sh.mode & 0o111, 'the macOS updater must stay executable');
    assert.ok((await stat(`${out}.zip`)).size > 0);
    assert.match(await readFile(path.join(out, 'VERSION.txt'), 'utf8'), /^ExamEye \d+\.\d+\.\d+\r\n/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
