#!/bin/bash
# ExamEye updater for macOS. Runs at login and hourly (launchd agent in.exameye.update, installed by
# Install-ExamEye.command). Swaps the extension folder only while Chrome is closed, so a running
# exam never sees mixed files. Log: ~/ExamEye-updater/update.log
set -u
BASE_URL="${EXAMEYE_UPDATE_URL:-https://github.com/goiitians/exameye/releases/latest/download}"
EXT="$HOME/ExamEye"
NEW="$EXT.new"
OLD="$EXT.old"
DIR="$HOME/ExamEye-updater"
LOG="$DIR/update.log"
mkdir -p "$DIR"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >> "$LOG"; }
version_of() { sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$1" | head -1; }
chrome_running() { pgrep -xq 'Google Chrome' || pgrep -xq 'Microsoft Edge'; }
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

# a run that died between the two renames of the swap left the live folder under the .old name
[ -d "$EXT" ] || { [ -d "$OLD" ] && mv "$OLD" "$EXT"; }
[ -f "$EXT/manifest.json" ] || { log 'failed: not installed'; exit 0; }
installed=$(version_of "$EXT/manifest.json")
body=$(curl -fsSL --max-time 30 "$BASE_URL/version.txt") || { log 'failed: cannot read version.txt'; exit 0; }
latest=$(printf '%s' "$body" | tr -d '[:space:]')
[ -n "$latest" ] || { log 'failed: empty version.txt'; exit 0; }
newer "$latest" "$installed" || { log "up to date $installed"; exit 0; }
chrome_running && { log "skipped $latest: chrome running"; exit 0; }

tmp=$(mktemp -d "${TMPDIR:-/tmp}/exameye-update.XXXXXX") || { log 'failed: mktemp'; exit 0; }
trap 'rm -rf "$tmp" "$NEW"' EXIT
curl -fsSL --max-time 300 -o "$tmp/exameye-installer.zip" "$BASE_URL/exameye-installer.zip" || { log 'failed: download'; exit 0; }
unzip -q "$tmp/exameye-installer.zip" -d "$tmp" || { log 'failed: unzip'; exit 0; }
src="$tmp/exameye-installer"
got=$(version_of "$src/ExamEye/manifest.json")
[ "$got" = "$latest" ] || { log "failed: bad archive ($got)"; exit 0; }
# stage next to the live folder and swap by two renames: a failure anywhere leaves the live folder untouched
rm -rf "$NEW" "$OLD"
cp -R "$src/ExamEye" "$NEW" || { log 'failed: mirror'; exit 0; }
# defaults.json carries the seat id typed at install and is read once, on first install
if [ -f "$EXT/defaults.json" ]; then cp "$EXT/defaults.json" "$NEW/defaults.json" || { log 'failed: defaults'; exit 0; }; fi
chrome_running && { log "skipped $latest: chrome running"; exit 0; }
mv "$EXT" "$OLD" || { log 'failed: swap'; exit 0; }
mv "$NEW" "$EXT" || { mv "$OLD" "$EXT"; log 'failed: swap'; exit 0; }
note=''
rm -rf "$OLD" || note="$note (cleanup failed)"
{ cp "$src/update-exameye.sh" "$DIR/update-exameye.sh.tmp" && mv -f "$DIR/update-exameye.sh.tmp" "$DIR/update-exameye.sh"; } || note="$note (self-copy failed)"
log "updated $installed -> $latest$note"
