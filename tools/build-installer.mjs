// Assembles dist/exameye-installer (and a zip of it) from the repo: the extension files plus
// installer/defaults.json, the launcher scripts, the read-me and the staff documents.
// Run: node tools/build-installer.mjs
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'dist/exameye-installer');
const EXT = path.join(OUT, 'ExamEye');
const manifest = JSON.parse(await readFile(path.join(ROOT, 'manifest.json'), 'utf8'));

// dist/ is this script's own output (git-ignored); rebuilding starts from a clean copy
await rm(OUT, { recursive: true, force: true });
await mkdir(EXT, { recursive: true });
for (const f of ['manifest.json', 'src', 'icons']) await cp(path.join(ROOT, f), path.join(EXT, f), { recursive: true });
await cp(path.join(ROOT, 'installer/defaults.json'), path.join(EXT, 'defaults.json'));
for (const f of ['Install-ExamEye.cmd', 'Install-ExamEye.command', 'READ-ME-FIRST.txt']) await cp(path.join(ROOT, 'installer', f), path.join(OUT, f));
for (const f of ['ExamEye-guide.pdf', 'ExamEye-overview.pptx']) await cp(path.join(ROOT, 'docs/deck', f), path.join(OUT, f));
// Windows reads the .cmd with CRLF line endings
await writeFile(path.join(OUT, 'Install-ExamEye.cmd'), (await readFile(path.join(OUT, 'Install-ExamEye.cmd'), 'utf8')).replace(/\r?\n/g, '\r\n'));
await writeFile(path.join(OUT, 'READ-ME-FIRST.txt'), (await readFile(path.join(OUT, 'READ-ME-FIRST.txt'), 'utf8')).replace(/\r?\n/g, '\r\n'));
await writeFile(path.join(OUT, 'VERSION.txt'), `ExamEye ${manifest.version}\r\nbuilt ${new Date().toISOString()}\r\n`);
const zip = path.join(ROOT, 'dist/exameye-installer.zip');
await rm(zip, { force: true });
execFileSync('zip', ['-qr', zip, 'exameye-installer'], { cwd: path.join(ROOT, 'dist') });
console.log('wrote', OUT, 'and', zip);
