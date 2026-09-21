# ExamEye Self-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A manually triggered GitHub release, plus a per-machine updater (Windows Scheduled Task, macOS launchd agent) that replaces the unpacked ExamEye folder only while Chrome is closed.

**Architecture:** A `workflow_dispatch` GitHub Actions workflow stamps `0.1.<run number>` into the built manifest, runs check + unit tests, builds the existing installer and publishes `exameye-installer.zip` + `version.txt` as release assets. Two OS-native scripts shipped inside the installer compare the installed manifest version with the latest `version.txt`, and mirror the new `ExamEye/` folder over `<home>/ExamEye` (keeping `defaults.json`) when Chrome is not running. The installers register the scripts as scheduled jobs.

**Tech Stack:** Node 22 ESM, `node:test`, GitHub Actions (`gh` CLI, built-in token), PowerShell 5.1 (Windows 10+), bash 3.2 + launchd (macOS), `robocopy` / `rsync`.

**Spec:** `docs/superpowers/specs/2026-09-21-auto-update-design.md` (read it first; the plan argues from it).

## Global Constraints

- Release only on `workflow_dispatch`; never on `push` or `pull_request`.
- Built version is `0.1.<github.run_number>`; the committed `manifest.json` stays `0.1.0`.
- Release assets: `exameye-installer.zip` and `version.txt` (bare version + newline). Tag and title `v0.1.<run_number>`.
- Updater download base URL: `https://github.com/goiitians/exameye/releases/latest/download`; overridable by `-BaseUrl` (PowerShell) / `EXAMEYE_UPDATE_URL` (bash).
- Updater never swaps while `chrome`/`msedge` (Windows) or `Google Chrome`/`Microsoft Edge` (macOS) runs.
- Mirror excludes `defaults.json`. Updater files live in `<home>/ExamEye-updater/` with log `update.log`, one line per run: `<ISO UTC time> <outcome>` where outcome is one of `up to date <v>`, `skipped <v>: chrome running`, `updated <old> -> <new>`, `failed: <reason>`.
- macOS default bash is 3.2: no associative arrays, no `mapfile`, no `${var,,}`.
- Repo rules: no comments unless the WHY is non-obvious; do not delete files; tests first; run `npm run check` and `npm test` before every commit; commit only the listed paths.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File map

| File | Responsibility |
|---|---|
| `src/popup/popup.html`, `src/popup/popup.js` | show the running version (Task 1) |
| `tests/unit/fake-chrome.js` | `runtime.getManifest()` for the popup test (Task 1) |
| `tests/unit/popup.test.js` | version line assertion (Task 1) |
| `tools/build-installer.mjs` | `EXAMEYE_DIST` output dir; copy both updater scripts (Task 2) |
| `tests/unit/build-installer.test.js` | builds into a temp dir and checks the output (Task 2) |
| `installer/Update-ExamEye.ps1` | Windows updater (Task 3) |
| `installer/update-exameye.sh` | macOS updater (Task 4) |
| `installer/Install-ExamEye.cmd`, `installer/Install-ExamEye.command` | copy the updater, register the job (Task 5) |
| `installer/READ-ME-FIRST.txt`, `docs/centre-setup.md`, `docs/superpowers/specs/2026-09-12-exameye-design.md` | documentation (Task 5) |
| `.github/workflows/release.yml` | manual release (Task 6) |
| `.superpowers/sdd/2026-09-13-test-finish/progress.md` | progress note (Task 7) |

---

### Task 1: Popup shows the running version

**Files:**
- Modify: `src/popup/popup.html` (the `<dl>` block)
- Modify: `src/popup/popup.js` (`render()`)
- Modify: `tests/unit/fake-chrome.js` (runtime block, ~line 11)
- Modify: `tests/unit/popup.test.js` (slot list line 8, and the idle render test)

**Interfaces:**
- Produces: popup element `#version` with text `chrome.runtime.getManifest().version`. Fake: `chrome.runtime.getManifest()` returns `{ version: '0.1.0' }`.

- [ ] **Step 1: Write the failing test**

In `tests/unit/popup.test.js` change the slot list on line 8 to include `version`:

```js
const dom = installFakeDom(['state', 'session', 'flush', 'errors', 'counts', 'options', 'desktop', 'flags', 'version']);
```

and in the test `'render: idle with nothing stored'` add after `assert.equal(dom.flags.textContent, '0');`:

```js
  assert.equal(dom.version.textContent, '0.1.0', 'staff read the running version off the popup to confirm an update landed');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/unit/popup.test.js`
Expected: FAIL in `render: idle with nothing stored` with `actual: ''` (the slot exists in the fake DOM but nothing fills it) or a TypeError `chrome.runtime.getManifest is not a function` once the code is added before the fake.

- [ ] **Step 3: Add `getManifest` to the fake and the version line to the popup**

`tests/unit/fake-chrome.js`, in the `runtime:` object right after `getURL: ...,`:

```js
      getManifest: () => ({ version: '0.1.0' }),
```

`src/popup/popup.html`, inside the `<dl>` after the `Session` row:

```html
  <dt>Version</dt><dd id="version"></dd>
```

`src/popup/popup.js`, in `render()` after the `$('session')` line:

```js
  $('version').textContent = chrome.runtime.getManifest().version;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/unit/popup.test.js` then `npm run check && npm test`
Expected: PASS; unit total 337 (was 336).

- [ ] **Step 5: Commit**

```bash
git add src/popup/popup.html src/popup/popup.js tests/unit/fake-chrome.js tests/unit/popup.test.js
git commit -m "feat(popup): show the running version so staff can confirm an update landed

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Installer build takes an output directory and ships the updater scripts

**Files:**
- Modify: `tools/build-installer.mjs` (whole file, 30 lines)
- Create: `tests/unit/build-installer.test.js`
- Create (placeholders replaced in Tasks 3 and 4): `installer/Update-ExamEye.ps1`, `installer/update-exameye.sh`

**Interfaces:**
- Consumes: `installer/Update-ExamEye.ps1` and `installer/update-exameye.sh` must exist (Tasks 3 and 4 write their real contents; this task creates them with a one-line comment so the build and test run now).
- Produces: env `EXAMEYE_DIST=<absolute dir>` selects the output folder; the zip is written next to it as `<dir>.zip`. Output root contains `Update-ExamEye.ps1` (CRLF) and `update-exameye.sh` (mode 755).

- [ ] **Step 1: Create the two script files with a first line only**

`installer/Update-ExamEye.ps1`:

```powershell
# ExamEye updater for Windows (see docs/superpowers/specs/2026-09-21-auto-update-design.md); real body in Task 3
```

`installer/update-exameye.sh`:

```bash
#!/bin/bash
# ExamEye updater for macOS (see docs/superpowers/specs/2026-09-21-auto-update-design.md); real body in Task 4
```

Run: `chmod +x installer/update-exameye.sh`

- [ ] **Step 2: Write the failing test**

`tests/unit/build-installer.test.js`:

```js
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test tests/unit/build-installer.test.js`
Expected: FAIL with `ENOENT ... exameye-dist-.../exameye-installer/ExamEye/manifest.json` (the tool ignores `EXAMEYE_DIST` and writes to `dist/`).

- [ ] **Step 4: Change the build tool**

Replace `tools/build-installer.mjs` with:

```js
// Assembles the installer folder (and a zip of it) from the repo: the extension files plus
// installer/defaults.json, the launcher scripts, the updater scripts, the read-me and the staff documents.
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
for (const f of ['Install-ExamEye.cmd', 'Install-ExamEye.command', 'READ-ME-FIRST.txt', 'Update-ExamEye.ps1', 'update-exameye.sh']) await cp(path.join(ROOT, 'installer', f), path.join(OUT, f));
for (const f of ['ExamEye-guide.pdf', 'ExamEye-overview.pptx']) await cp(path.join(ROOT, 'docs/deck', f), path.join(OUT, f));
// Windows reads these with CRLF line endings
for (const f of ['Install-ExamEye.cmd', 'READ-ME-FIRST.txt', 'Update-ExamEye.ps1']) await crlf(path.join(OUT, f));
await chmod(path.join(OUT, 'update-exameye.sh'), 0o755);
await writeFile(path.join(OUT, 'VERSION.txt'), `ExamEye ${manifest.version}\r\nbuilt ${new Date().toISOString()}\r\n`);
const zip = `${OUT}.zip`;
await rm(zip, { force: true });
execFileSync('zip', ['-qr', zip, path.basename(OUT)], { cwd: path.dirname(OUT) });
console.log('wrote', OUT, 'and', zip);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/unit/build-installer.test.js` then `npm run check && npm test`
Expected: PASS; the default build (`node tools/build-installer.mjs`) still writes `dist/exameye-installer` and `dist/exameye-installer.zip`.

- [ ] **Step 6: Commit**

```bash
git add tools/build-installer.mjs tests/unit/build-installer.test.js installer/Update-ExamEye.ps1 installer/update-exameye.sh
git commit -m "feat(installer): build into EXAMEYE_DIST and ship the updater scripts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Windows updater script

**Files:**
- Modify: `installer/Update-ExamEye.ps1` (replace the placeholder)

**Interfaces:**
- Consumes: release assets `version.txt` and `exameye-installer.zip` at `<BaseUrl>/`; the zip contains a top-level `exameye-installer/` folder with `ExamEye/manifest.json` and `Update-ExamEye.ps1`.
- Produces: `%USERPROFILE%\ExamEye-updater\update.log` lines; mirrors `%USERPROFILE%\ExamEye`.

No automated test exists for PowerShell on this Mac (spec §6). The verification is Step 3 below, on the owner's Windows PC, and a syntax read.

- [ ] **Step 1: Write the script**

Replace `installer/Update-ExamEye.ps1` with:

```powershell
# ExamEye updater for Windows. Runs at logon and hourly (Scheduled Task "ExamEye Update",
# registered by Install-ExamEye.cmd). Swaps the extension folder only while Chrome is closed,
# so a running exam never sees mixed files. Log: %USERPROFILE%\ExamEye-updater\update.log
param([string]$BaseUrl = 'https://github.com/goiitians/exameye/releases/latest/download')
$ErrorActionPreference = 'Stop'
$ext = Join-Path $env:USERPROFILE 'ExamEye'
$dir = Join-Path $env:USERPROFILE 'ExamEye-updater'
$log = Join-Path $dir 'update.log'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

function Log($msg) { Add-Content -Path $log -Value ("{0} {1}" -f (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'), $msg) }
function VersionOf($manifest) { (Get-Content -Raw $manifest | ConvertFrom-Json).version }
function Newer($a, $b) {
  $x = $a.Split('.'); $y = $b.Split('.')
  for ($i = 0; $i -lt [Math]::Max($x.Count, $y.Count); $i++) {
    $p = if ($i -lt $x.Count) { [int]$x[$i] } else { 0 }
    $q = if ($i -lt $y.Count) { [int]$y[$i] } else { 0 }
    if ($p -ne $q) { return $p -gt $q }
  }
  return $false
}

$tmp = $null
try {
  $manifest = Join-Path $ext 'manifest.json'
  if (-not (Test-Path $manifest)) { Log 'failed: not installed'; exit 0 }
  $installed = VersionOf $manifest
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $latest = (Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/version.txt").Content.Trim()
  if (-not (Newer $latest $installed)) { Log "up to date $installed"; exit 0 }
  if (Get-Process -Name chrome, msedge -ErrorAction SilentlyContinue) { Log "skipped ${latest}: chrome running"; exit 0 }
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ('exameye-update-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  $zip = Join-Path $tmp 'exameye-installer.zip'
  Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/exameye-installer.zip" -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath $tmp
  $src = Join-Path $tmp 'exameye-installer'
  $got = VersionOf (Join-Path $src 'ExamEye\manifest.json')
  if ($got -ne $latest) { Log "failed: bad archive ($got)"; exit 0 }
  # defaults.json carries the seat id typed at install and is read once, on first install
  robocopy (Join-Path $src 'ExamEye') $ext /MIR /XF defaults.json /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { Log 'failed: mirror'; exit 0 }
  Copy-Item (Join-Path $src 'Update-ExamEye.ps1') (Join-Path $dir 'Update-ExamEye.ps1') -Force
  Log "updated $installed -> $latest"
} catch {
  Log ('failed: ' + $_.Exception.Message)
} finally {
  if ($tmp -and (Test-Path $tmp)) { Remove-Item -Recurse -Force $tmp }
}
```

- [ ] **Step 2: Syntax read and unit suite**

Read the file once top to bottom checking: every `Log` outcome matches the Global Constraints wording; `exit 0` inside `try` still runs `finally` (it does in PowerShell); `robocopy` exit codes below 8 are success. Run `npm run check && npm test` (the build test from Task 2 checks CRLF conversion of this file).
Expected: unit suite PASS.

- [ ] **Step 3: Record the Windows verification steps for the owner**

Append to `installer/READ-ME-FIRST.txt` is done in Task 5; here only note in the commit body that the script is verified on Windows at the first release by: `powershell -NoProfile -ExecutionPolicy Bypass -File %USERPROFILE%\ExamEye-updater\Update-ExamEye.ps1` with Chrome open (log: `skipped ...: chrome running` or `up to date ...`), then with Chrome closed after a new release (log: `updated ... -> ...`, popup shows the new version).

- [ ] **Step 4: Commit**

```bash
git add installer/Update-ExamEye.ps1
git commit -m "feat(updater): Windows updater script, swaps the extension only while Chrome is closed

Verified on Windows at the first release (see READ-ME-FIRST, Publish a new version).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: macOS updater script, verified against a local fake release

**Files:**
- Modify: `installer/update-exameye.sh` (replace the placeholder)
- Scratch (not committed): `/private/tmp/claude-501/-Users-pawank-DiskAlpha-Development-exameye/<session>/scratchpad/fake-release/`

**Interfaces:**
- Consumes: same assets as Task 3; `EXAMEYE_UPDATE_URL` overrides the base URL.
- Produces: `$HOME/ExamEye-updater/update.log`; mirrors `$HOME/ExamEye`.

The verification uses a temporary `HOME` so the owner's real `~/ExamEye` is never touched.

- [ ] **Step 1: Write the script**

Replace `installer/update-exameye.sh` with:

```bash
#!/bin/bash
# ExamEye updater for macOS. Runs at login and hourly (launchd agent in.exameye.update, installed by
# Install-ExamEye.command). Swaps the extension folder only while Chrome is closed, so a running
# exam never sees mixed files. Log: ~/ExamEye-updater/update.log
set -u
BASE_URL="${EXAMEYE_UPDATE_URL:-https://github.com/goiitians/exameye/releases/latest/download}"
EXT="$HOME/ExamEye"
DIR="$HOME/ExamEye-updater"
LOG="$DIR/update.log"
mkdir -p "$DIR"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >> "$LOG"; }
version_of() { sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$1" | head -1; }
newer() {
  local IFS=.
  local -a a=($1) b=($2)
  local i p q
  for ((i = 0; i < ${#a[@]} || i < ${#b[@]}; i++)); do
    p=${a[i]:-0}; q=${b[i]:-0}
    if ((p != q)); then ((p > q)); return; fi
  done
  return 1
}

[ -f "$EXT/manifest.json" ] || { log 'failed: not installed'; exit 0; }
installed=$(version_of "$EXT/manifest.json")
latest=$(curl -fsSL --max-time 30 "$BASE_URL/version.txt" | tr -d '[:space:]') || { log 'failed: cannot read version.txt'; exit 0; }
[ -n "$latest" ] || { log 'failed: empty version.txt'; exit 0; }
newer "$latest" "$installed" || { log "up to date $installed"; exit 0; }
if pgrep -xq 'Google Chrome' || pgrep -xq 'Microsoft Edge'; then log "skipped $latest: chrome running"; exit 0; fi

tmp=$(mktemp -d "${TMPDIR:-/tmp}/exameye-update.XXXXXX") || { log 'failed: mktemp'; exit 0; }
trap 'rm -rf "$tmp"' EXIT
curl -fsSL --max-time 300 -o "$tmp/exameye-installer.zip" "$BASE_URL/exameye-installer.zip" || { log 'failed: download'; exit 0; }
unzip -q "$tmp/exameye-installer.zip" -d "$tmp" || { log 'failed: unzip'; exit 0; }
src="$tmp/exameye-installer"
got=$(version_of "$src/ExamEye/manifest.json")
[ "$got" = "$latest" ] || { log "failed: bad archive ($got)"; exit 0; }
# defaults.json carries the seat id typed at install and is read once, on first install
rsync -a --delete --exclude defaults.json "$src/ExamEye/" "$EXT/" || { log 'failed: mirror'; exit 0; }
cp "$src/update-exameye.sh" "$DIR/update-exameye.sh"
log "updated $installed -> $latest"
```

Run: `bash -n installer/update-exameye.sh` (syntax) and `chmod +x installer/update-exameye.sh`.

- [ ] **Step 2: Build a fake release and a fake installed copy in the scratchpad**

```bash
S=/private/tmp/claude-501/-Users-pawank-DiskAlpha-Development-exameye/2724409c-6c8c-47a5-8284-dfb0892a147d/scratchpad/fake-release
mkdir -p "$S/home" "$S/site"
# installed copy at version 0.1.0 (the repo's manifest)
EXAMEYE_DIST="$S/installed" node tools/build-installer.mjs
cp -R "$S/installed/ExamEye" "$S/home/ExamEye"
echo '{"seat":"Z99"}' > "$S/home/ExamEye/defaults.json"
# "latest" release at 0.1.999 built from a stamped manifest copy
cp manifest.json "$S/manifest.orig.json"
node -e "const fs=require('fs');const m=JSON.parse(fs.readFileSync('manifest.json','utf8'));m.version='0.1.999';fs.writeFileSync('manifest.json',JSON.stringify(m,null,2)+'\n')"
EXAMEYE_DIST="$S/site/exameye-installer" node tools/build-installer.mjs
cp "$S/manifest.orig.json" manifest.json
git diff --quiet manifest.json && echo manifest restored
echo 0.1.999 > "$S/site/version.txt"
(cd "$S/site" && python3 -m http.server 8765 >/dev/null 2>&1 &) ; sleep 1
```

- [ ] **Step 3: Run the updater with Chrome open, then closed**

With Google Chrome running (it normally is on this Mac):

```bash
HOME="$S/home" EXAMEYE_UPDATE_URL=http://127.0.0.1:8765 bash installer/update-exameye.sh; tail -1 "$S/home/ExamEye-updater/update.log"
```
Expected: `... skipped 0.1.999: chrome running`, and `$S/home/ExamEye/manifest.json` still says `0.1.0`.

Then, with Chrome quit (ask the owner, or run the check with the process names temporarily unmatched by exporting nothing and instead verifying the branch on the fake: `HOME="$S/home" EXAMEYE_UPDATE_URL=http://127.0.0.1:8765 bash -c 'pgrep() { return 1; }; export -f pgrep; source installer/update-exameye.sh'`):

```bash
tail -1 "$S/home/ExamEye-updater/update.log"; grep '"version"' "$S/home/ExamEye/manifest.json"; cat "$S/home/ExamEye/defaults.json"; ls "$S/home/ExamEye-updater"
```
Expected: `... updated 0.1.0 -> 0.1.999`; manifest `0.1.999`; `defaults.json` still `{"seat":"Z99"}`; the updater folder holds `update-exameye.sh` and `update.log`.

Run once more: expected `up to date 0.1.999`. Stop the server: `pkill -f 'http.server 8765'`.

- [ ] **Step 4: Unit suite and commit**

Run: `npm run check && npm test`
Expected: PASS.

```bash
git add installer/update-exameye.sh
git commit -m "feat(updater): macOS updater script, verified against a local fake release

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Installers register the updater; documents

**Files:**
- Modify: `installer/Install-ExamEye.cmd` (after the `clip` line, before `start chrome`)
- Modify: `installer/Install-ExamEye.command` (after the `pbcopy` line, before `open -a`)
- Modify: `installer/READ-ME-FIRST.txt`
- Modify: `docs/centre-setup.md` (section 1)
- Modify: `docs/superpowers/specs/2026-09-12-exameye-design.md` (after the paragraph ending `next to the manifest in the pen-drive installer.`)

**Interfaces:**
- Consumes: `Update-ExamEye.ps1` and `update-exameye.sh` at the installer root (Task 2 layout).
- Produces: Scheduled Task `ExamEye Update`; launchd agent `in.exameye.update`.

- [ ] **Step 1: Windows installer**

In `installer/Install-ExamEye.cmd`, insert after the line `<nul set /p "=%DEST%" | clip`:

```bat
set "UPD=%USERPROFILE%\ExamEye-updater"
if not exist "%UPD%" mkdir "%UPD%"
copy /Y "%~dp0Update-ExamEye.ps1" "%UPD%\Update-ExamEye.ps1" >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "$a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"' + $env:USERPROFILE + '\ExamEye-updater\Update-ExamEye.ps1\"'); $t = @((New-ScheduledTaskTrigger -AtLogOn), (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Days 3650))); Register-ScheduledTask -TaskName 'ExamEye Update' -Action $a -Trigger $t -Force | Out-Null"
if errorlevel 1 (
  echo Could not register the hourly update task. ExamEye still works; updates will need a re-install.
) else (
  echo Automatic updates registered (task "ExamEye Update": at logon and hourly, only while Chrome is closed).
)
```

- [ ] **Step 2: macOS installer**

In `installer/Install-ExamEye.command`, insert after the line `printf '%s' "$DEST" | pbcopy`:

```bash
UPD="$HOME/ExamEye-updater"
mkdir -p "$UPD" "$HOME/Library/LaunchAgents"
cp "$(dirname "$SRC")/update-exameye.sh" "$UPD/update-exameye.sh"
chmod +x "$UPD/update-exameye.sh"
PL="$HOME/Library/LaunchAgents/in.exameye.update.plist"
cat > "$PL" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>in.exameye.update</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$UPD/update-exameye.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>3600</integer>
  <key>StandardOutPath</key><string>$UPD/launchd.log</string>
  <key>StandardErrorPath</key><string>$UPD/launchd.log</string>
</dict></plist>
PLIST
launchctl bootout "gui/$(id -u)/in.exameye.update" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PL" 2>/dev/null || launchctl load "$PL"
echo "Automatic updates registered (launchd agent in.exameye.update: at login and hourly, only while Chrome is closed)."
```

- [ ] **Step 3: Read-me**

In `installer/READ-ME-FIRST.txt` replace the heading block

```
What is on this pen drive
  ExamEye\                  the extension (do not open or edit; the installer copies it)
  Install-ExamEye.cmd       Windows: double-click this
  Install-ExamEye.command   macOS: double-click this (or run it from Terminal, see below)
  ExamEye-guide.pdf         what ExamEye does and how to read its reports
  ExamEye-overview.pptx     the same as slides
```

with

```
What is in this folder
  ExamEye\                  the extension (do not open or edit; the installer copies it)
  Install-ExamEye.cmd       Windows: double-click this
  Install-ExamEye.command   macOS: double-click this (or run it from Terminal, see below)
  Update-ExamEye.ps1        Windows updater (the installer registers it; nothing to run by hand)
  update-exameye.sh         macOS updater (same)
  ExamEye-guide.pdf         what ExamEye does and how to read its reports
  ExamEye-overview.pptx     the same as slides

Get this folder from GitHub instead of a pen drive
  Open https://github.com/goiitians/exameye/releases, download exameye-installer.zip from the
  newest release, extract it, then follow the install steps below from the extracted folder.

Automatic updates
  The installer registers a job that runs at logon and once an hour. It downloads a newer release
  when there is one and replaces the ExamEye folder only while Chrome is closed, so a running exam
  is never touched. The new version is live the next time Chrome starts. The ExamEye popup shows
  the running version. Log: <home>\ExamEye-updater\update.log (one line per run).

Publish a new version (owner)
  GitHub > Actions > Release > Run workflow (branch main). Wait for the green tick; the release
  v0.1.<number> appears under Releases. Machines pick it up within an hour of their next Chrome
  restart. Do not publish during exam hours. To check the updater on one PC right away:
  close Chrome, then run  powershell -NoProfile -ExecutionPolicy Bypass -File %USERPROFILE%\ExamEye-updater\Update-ExamEye.ps1
  and read the last line of update.log.
```

- [ ] **Step 4: centre-setup and main spec**

`docs/centre-setup.md`, in section 1 after the pen-drive installer bullet list, add:

```markdown
**GitHub release (same installer, no pen drive) and automatic updates**
- Releases are published by hand: GitHub > Actions > Release > Run workflow on `main`. CI runs the unit tests, stamps version `0.1.<run number>`, builds the installer and attaches `exameye-installer.zip` + `version.txt` to release `v0.1.<run number>`. Nothing is published on a push.
- Install from GitHub: download `exameye-installer.zip` from the newest release, extract, run the installer as above.
- Both installers register an updater (Windows Scheduled Task `ExamEye Update`; macOS launchd agent `in.exameye.update`): at logon and hourly it fetches `version.txt`, and only when a newer version exists **and Chrome is closed** it mirrors the new `ExamEye/` folder over `<home>/ExamEye` (keeping `defaults.json`). Log: `<home>/ExamEye-updater/update.log`. The popup shows the running version. Design: `docs/superpowers/specs/2026-09-21-auto-update-design.md`.
```

`docs/superpowers/specs/2026-09-12-exameye-design.md`, after the paragraph that ends `next to the manifest in the pen-drive installer.`, add:

```markdown
Self-update (2026-09-21): a manual GitHub release (`workflow_dispatch`, version `0.1.<run number>`
stamped at build time) and a per-machine updater that replaces `<home>/ExamEye` only while Chrome
is closed, keeping `defaults.json`. Full design and the updater's log contract:
`docs/superpowers/specs/2026-09-21-auto-update-design.md`. The popup shows
`runtime.getManifest().version` so staff can confirm which build a machine runs.
```

- [ ] **Step 5: Build and inspect, then commit**

Run: `npm run check && npm test && node tools/build-installer.mjs && ls dist/exameye-installer && grep -c 'ExamEye Update' dist/exameye-installer/Install-ExamEye.cmd && grep -c 'in.exameye.update' dist/exameye-installer/Install-ExamEye.command`
Expected: tests PASS; both greps print `1` or more; the folder lists both updater scripts. Then run `bash -n dist/exameye-installer/Install-ExamEye.command`.

```bash
git add installer/Install-ExamEye.cmd installer/Install-ExamEye.command installer/READ-ME-FIRST.txt docs/centre-setup.md docs/superpowers/specs/2026-09-12-exameye-design.md
git commit -m "feat(installer): register the updater job on install; document the GitHub route and manual releases

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Manual release workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `npm run check`, `npm test`, `tools/build-installer.mjs` default output `dist/exameye-installer.zip`.
- Produces: release `v0.1.<run_number>` with assets `exameye-installer.zip`, `version.txt`.

- [ ] **Step 1: Write the workflow**

```yaml
# Manual only: nothing is published on push or merge. The integration suite (real Chromium with
# screen capture) is not run here; it stays a local pre-push check.
name: Release
on:
  workflow_dispatch:
permissions:
  contents: write
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run check
      - run: npm test
      - name: Stamp version 0.1.<run number> into the built manifest
        run: |
          V="0.1.${{ github.run_number }}"
          node -e "const fs=require('fs');const m=JSON.parse(fs.readFileSync('manifest.json','utf8'));m.version=process.argv[1];fs.writeFileSync('manifest.json',JSON.stringify(m,null,2)+'\n')" "$V"
          printf '%s\n' "$V" > version.txt
          echo "VERSION=$V" >> "$GITHUB_ENV"
      - run: node tools/build-installer.mjs
      - name: Publish release
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          PREV=$(git describe --tags --abbrev=0 2>/dev/null || true)
          if [ -n "$PREV" ]; then NOTES=$(git log --oneline "$PREV..HEAD"); else NOTES=$(git log --oneline -20); fi
          gh release create "v$VERSION" dist/exameye-installer.zip version.txt --title "v$VERSION" --notes "$NOTES"
```

- [ ] **Step 2: Validate locally**

Run: `node -e "const fs=require('fs');const m=JSON.parse(fs.readFileSync('manifest.json','utf8'));m.version='0.1.42';console.log(JSON.stringify(m,null,2).split('\n').length)"` (the stamping one-liner parses and rewrites the manifest; it must not throw). Run `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml'))" 2>/dev/null || node -e "console.log('yaml module absent, skip')"` for a syntax check when PyYAML exists. Confirm `git diff --quiet manifest.json` (the one-liner above printed but did not write).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: manual Release workflow publishing exameye-installer.zip and version.txt as v0.1.<run number>

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Progress note, final verification, first release checklist

**Files:**
- Modify: `.superpowers/sdd/2026-09-13-test-finish/progress.md` (append)

- [ ] **Step 1: Append the note**

```markdown
## 2026-09-21 self-update (Fable plan, spec docs/superpowers/specs/2026-09-21-auto-update-design.md)
- Manual Release workflow (workflow_dispatch only) stamps 0.1.<run number>, runs check + unit, builds the installer, publishes exameye-installer.zip + version.txt. Integration suite stays local.
- Updaters: installer/Update-ExamEye.ps1 (Scheduled Task "ExamEye Update", logon + hourly) and installer/update-exameye.sh (launchd in.exameye.update, RunAtLoad + 3600 s). Swap only while Chrome is closed; defaults.json kept; log <home>/ExamEye-updater/update.log. Both registered by the installers. Popup shows the version.
- Verified: unit suite (build-installer test builds into a temp dir); macOS updater against a local fake release (skipped while Chrome ran, updated after, up to date on the third run, defaults.json kept). NOT verified: Update-ExamEye.ps1 and the .cmd task registration (no Windows here), the workflow itself (needs the first manual run), anonymous download (needs the repo public).
- Owner steps before the first release: make the repo public; Actions > Release > Run workflow; on one Windows PC run the updater by hand with Chrome closed and read update.log; confirm the popup version.
```

- [ ] **Step 2: Final verification**

Run: `npm run check && npm test && npm run test:integration && node tools/build-installer.mjs`
Expected: check clean, unit all pass (338: 336 + popup + build test), integration 4/4, build writes `dist/exameye-installer`.

- [ ] **Step 3: Report**

The progress file is git-ignored; nothing to commit. End the run with the owner checklist from Step 1 and the list of commits made.

---

## Self-review

- Spec §1 decisions: manual trigger (Task 6), Chrome-closed swap (Tasks 3, 4), public repo (owner action, Task 7 checklist), both platforms (Tasks 3, 4, 5). Covered.
- Spec §2 pipeline: Task 6 matches step for step (ci, check, test, stamp, build, `gh release create` with two assets, tag/title `v0.1.<n>`, notes = commits since the previous tag). Covered.
- Spec §3 updater: seven steps and the log contract appear verbatim in Tasks 3 and 4; the base URL override (`-BaseUrl` / `EXAMEYE_UPDATE_URL`) is present; the updater copies itself last. Covered.
- Spec §4: installers (Task 5 Steps 1, 2), build tool (Task 2), read-me / centre-setup / main spec (Task 5 Steps 3, 4), popup version (Task 1). Covered.
- Spec §5 safety: encoded in the scripts (temp extraction, manifest check before mirror, Chrome check). Covered.
- Spec §6 testing: popup test (Task 1), build test (Task 2), macOS scratch run (Task 4 Step 3), Windows and workflow verification recorded as owner steps (Task 7). Covered.
- Placeholders: Task 2 Step 1 creates one-line stubs that Tasks 3 and 4 replace; both are stated. No "TBD".
- Names: `EXAMEYE_DIST` (Tasks 2, 4, 6 uses default), `Update-ExamEye.ps1` / `update-exameye.sh` (Tasks 2 to 5), task name `ExamEye Update` and label `in.exameye.update` (Tasks 5, 7), log outcomes identical in Tasks 3 and 4 and the Global Constraints.
