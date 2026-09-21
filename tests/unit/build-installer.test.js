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
    for (const [f, head] of [['Update-ExamEye.cmd', '@echo off'], ['Update-ExamEye.vbs', "' ExamEye updater launcher"]]) {
      const text = await readFile(path.join(out, f), 'utf8');
      assert.ok(text.startsWith(head), `${f} starts with ${head}`);
      assert.ok(!/[^\r]\n/.test(text), `Windows reads ${f} with CRLF line endings`);
    }
    await assert.rejects(stat(path.join(out, 'Update-ExamEye.ps1')), 'no PowerShell script ships: a Group Policy execution policy blocks .ps1 files');
    const sh = await stat(path.join(out, 'update-exameye.sh'));
    assert.ok(sh.mode & 0o111, 'the macOS updater must stay executable');
    assert.ok((await stat(`${out}.zip`)).size > 0);
    assert.match(await readFile(path.join(out, 'VERSION.txt'), 'utf8'), /^ExamEye \d+\.\d+\.\d+\r\n/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
