# ExamEye self-update: manual GitHub release, per-machine updater

Status: approved in brainstorm 2026-09-21, spec for implementation planning.

## 1. Goal and decisions

Exam PCs and the owner's Mac run ExamEye as an unpacked extension loaded from `<home>/ExamEye`.
Today a new version means a new pen drive. After this change:

- The owner publishes a release from GitHub's Actions tab ("Run workflow"). Nothing is published
  on a push to main or on a merge.
- Every machine checks for a newer release at logon and once an hour, downloads it, and swaps the
  extension folder **only while Chrome is closed**. The new version is live the next time Chrome
  opens. A running exam can never see mixed files.
- The repo `goiitians/exameye` becomes public so machines download releases anonymously (no token
  on any PC). Nothing in the repo is a secret: the centre defaults are seat ids and public URLs.
  Owner action on GitHub (Settings → Danger zone → Change visibility), not done by the code.
- Windows and macOS both self-update. The pen-drive installer keeps working and, in addition,
  registers the updater. A second install route exists: download the release zip from GitHub,
  extract, run the installer.

Out of scope: Chrome Web Store, enterprise policy install, updating while Chrome runs, rollback
automation, updating the deck documents on the PC.

## 2. Release pipeline (`.github/workflows/release.yml`)

Trigger: `workflow_dispatch` only, run on `main` from the Actions tab. No `push`, no `pull_request`.

Steps on `ubuntu-latest`, Node 22:

1. `npm ci`, `npm run check`, `npm test`. A failure stops the run; nothing is published.
2. Stamp the version: `manifest.json` `version` becomes `0.1.<github.run_number>` in the checkout
   only. The committed manifest stays `0.1.0`; the run number is monotonic, so the updater's
   comparison never goes backwards.
3. `node tools/build-installer.mjs` (unchanged; `zip` is present on the runner). It already writes
   `dist/exameye-installer/VERSION.txt`.
4. Publish release `v0.1.<run_number>` (title the same, body: the short commit list since the
   previous release) with two assets:
   - `exameye-installer.zip` (the folder built in step 3),
   - `version.txt` containing exactly `0.1.<run_number>` and a newline.
   The workflow needs `permissions: contents: write` and uses `gh release create` with the
   built-in `GITHUB_TOKEN`.

The integration suite (`npm run test:integration`, real Chromium with screen capture) is not run in
CI; it stays a local pre-push check. The workflow file says so in a comment.

Stable download URLs used by the updater (redirects, no API, so no per-IP rate limit when fifty PCs
share a centre's address):

- `https://github.com/goiitians/exameye/releases/latest/download/version.txt`
- `https://github.com/goiitians/exameye/releases/latest/download/exameye-installer.zip`

## 3. Updater

Two scripts with identical logic, shipped at the installer root and copied by the installer to
`<home>/ExamEye-updater/` (outside the extension folder, so the swap never touches them):

- Windows: `Update-ExamEye.ps1`, run by a per-user Scheduled Task `ExamEye Update`
  (triggers: at logon, and every hour; action: `powershell -NoProfile -ExecutionPolicy Bypass
  -WindowStyle Hidden -File <home>\ExamEye-updater\Update-ExamEye.ps1`). Registered with
  `Register-ScheduledTask` for the current user, no elevation, `MultipleInstances IgnoreNew` and
  `StartWhenAvailable` so an hourly run never overlaps a logon run.
- macOS: `update-exameye.sh`, run by a launchd agent `~/Library/LaunchAgents/in.exameye.update.plist`
  (`RunAtLoad` true, `StartInterval` 3600, stdout/stderr to the log below). Loaded with
  `launchctl bootstrap gui/$UID` (falls back to `launchctl load`).

Logic, in order; every exit writes one line to `<home>/ExamEye-updater/update.log`
(`<ISO time> <outcome>`), and the current version is left untouched on any failure:

1. `installed` = `version` from `<home>/ExamEye/manifest.json`. Missing → `failed: not installed`.
2. `latest` = body of `version.txt` from the base URL (default the GitHub URL above; a parameter
   `-BaseUrl` / env `EXAMEYE_UPDATE_URL` overrides it for tests). Unreachable → `failed: <reason>`.
   Unreadable → `failed: cannot read version.txt`; blank → `failed: empty version.txt`. Windows
   downloads it to a file: PowerShell 5.1 leaves `.Content` empty for `application/octet-stream`.
3. Compare numerically per dot-separated field. Not newer → `up to date <installed>`.
4. Chrome running (`chrome` or `msedge` process on Windows; `Google Chrome` or `Microsoft Edge` on
   macOS) → `skipped <latest>: chrome running`. The next hourly run retries.
5. Download the zip to a fresh temp folder, extract, and require `ExamEye/manifest.json` inside with
   `version` equal to `latest` (otherwise `failed: bad archive`).
6. Stage: copy `ExamEye/` from the extract to `<home>/ExamEye.new` (Windows `robocopy /E`, macOS
   `cp -R`), then copy the live `defaults.json` into it (it carries the seat id typed at install; it
   is read once on first install and must not be replaced; a failed copy is `failed: defaults`).
   Re-check Chrome (`skipped` if it started meanwhile). Swap by two renames: live → `ExamEye.old`,
   `.new` → live; if the second rename fails the first is undone. A failure anywhere before the
   swap leaves the live folder untouched; a run that died between the two renames is repaired at
   the next run's start (live missing and `.old` present → rename back).
7. Log `updated <installed> -> <latest>`, with ` (cleanup failed)` and/or ` (self-copy failed)`
   appended when deleting `ExamEye.old` or copying the updater script from the extract over its own
   copy fails (the self-copy is how a fixed updater reaches machines; on macOS it goes through a
   temp name and a rename because bash may still be reading the file). Still exactly one line.

Chrome loads the new files at its next start. An unpacked extension whose version changed fires
`runtime.onInstalled` with reason `update`; the SW already handles that by calling `boot()` and
does not reseed `defaults.json` (that happens only on `install`).

## 4. Installer and documents

- `Install-ExamEye.cmd` / `Install-ExamEye.command`: after the copy and seat prompt, copy the
  updater script to `<home>/ExamEye-updater/` and register the task / agent. Both steps are
  idempotent (re-registering replaces). The final on-screen text mentions that updates are
  automatic from now on.
- `tools/build-installer.mjs`: also copies the two updater scripts (CRLF for the `.ps1`), and takes
  the output directory from `EXAMEYE_DIST` when set (default `dist/exameye-installer`) so a test can
  build into a temp folder.
- `installer/READ-ME-FIRST.txt`: a "Install from GitHub" section (Releases page → download
  `exameye-installer.zip` → extract → run the installer as with the pen drive), a "Publish a new
  version" section for the owner (Actions → Release → Run workflow; wait for green; machines pick
  it up at their next Chrome start after the next hourly check), and a "Check which version a PC
  runs" line (the popup).
- Popup: a `Version` line showing `chrome.runtime.getManifest().version`.
- `docs/centre-setup.md`: the same three points, short.
- Main spec (`2026-09-12-exameye-design.md`): a one-paragraph pointer to this document under the
  installer section.

## 5. Safety and failure handling

- Never swap while Chrome runs: the only rule that protects a live exam. Mixed-version sessions are
  impossible because the folder changes only between Chrome runs.
- A bad or partial download cannot land: extraction and the manifest check happen in temp, the new
  folder is staged next to the live one, and the live folder changes only by rename. A staging
  failure (disk full, antivirus lock) logs `failed: mirror` and leaves the live folder untouched; the
  next hourly run starts over from a fresh download.
- GitHub unreachable: the PC keeps its version; the log shows why.
- Rollback: re-run any older `exameye-installer.zip` by hand. The updater only moves forward
  (numeric compare), so the next hourly run does not undo a deliberate downgrade until a newer
  release is published.
- Procedural rule: do not run the Release workflow during exam hours. Everything published reaches
  PCs at their next Chrome start.
- The updater has no secrets and no elevation; a compromised release is the same risk as a
  compromised pen drive and is out of scope.

## 6. Testing

- Unit (node:test): the popup version line (existing popup test); `build-installer` output lists
  the two updater scripts (a test that runs the build into a temp `OUT`, so the tool takes the output
  directory from an env var with the current default).
- macOS script: a scratch run on this Mac against a local static server serving `version.txt` and a
  zip built from the repo, with `EXAMEYE_UPDATE_URL` pointing at it and Chrome closed; then the same
  with Chrome open (expects `skipped`). Recorded in the progress note, not automated.
- Windows script: cannot run here. Kept to the seven steps above with no clever PowerShell; verified
  on the owner's Windows PC at the first release: log shows `up to date`, then after a new release
  `skipped: chrome running` with Chrome open, then `updated` after Chrome is closed and the popup
  shows the new version.
- Workflow: verified by the first manual run. The first run also confirms the anonymous download
  URLs on a machine with no GitHub login.
