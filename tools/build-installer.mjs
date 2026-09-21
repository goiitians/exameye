// Assembles the installer folder (and a zip of it) from the repo: the extension files plus
// installer/defaults.json, the launcher scripts, the updaters, the read-me and the staff documents.
// Run: node tools/build-installer.mjs            -> dist/exameye-installer (+ dist/exameye-installer.zip)
//      EXAMEYE_DIST=/abs/dir node tools/build-installer.mjs   -> that dir (+ <dir>.zip)
import { cp, mkdir, rm, readFile, writeFile, chmod } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = process.env.EXAMEYE_DIST ? path.resolve(process.env.EXAMEYE_DIST) : path.join(ROOT, 'dist/exameye-installer');
const EXT = path.join(OUT, 'ExamEye');
const manifest = JSON.parse(await readFile(path.join(ROOT, 'manifest.json'), 'utf8'));
const crlf = async (file) => writeFile(file, (await readFile(file, 'utf8')).replace(/\r?\n/g, '\r\n'));

// OUT is this script's own output; rebuilding starts from a clean copy
await rm(OUT, { recursive: true, force: true });
await mkdir(EXT, { recursive: true });
for (const f of ['manifest.json', 'src', 'icons']) await cp(path.join(ROOT, f), path.join(EXT, f), { recursive: true });
await cp(path.join(ROOT, 'installer/defaults.json'), path.join(EXT, 'defaults.json'));
for (const f of ['Install-ExamEye.cmd', 'Install-ExamEye.command', 'READ-ME-FIRST.txt', 'Update-ExamEye.cmd', 'Update-ExamEye.vbs', 'update-exameye.sh']) await cp(path.join(ROOT, 'installer', f), path.join(OUT, f));
for (const f of ['ExamEye-guide.pdf', 'ExamEye-overview.pptx']) await cp(path.join(ROOT, 'docs/deck', f), path.join(OUT, f));
// Windows reads these with CRLF line endings
for (const f of ['Install-ExamEye.cmd', 'READ-ME-FIRST.txt', 'Update-ExamEye.cmd', 'Update-ExamEye.vbs']) await crlf(path.join(OUT, f));
await chmod(path.join(OUT, 'update-exameye.sh'), 0o755);
await writeFile(path.join(OUT, 'VERSION.txt'), `ExamEye ${manifest.version}\r\nbuilt ${new Date().toISOString()}\r\n`);
const zip = `${OUT}.zip`;
await rm(zip, { force: true });
execFileSync('zip', ['-qr', zip, path.basename(OUT)], { cwd: path.dirname(OUT) });
console.log('wrote', OUT, 'and', zip);
