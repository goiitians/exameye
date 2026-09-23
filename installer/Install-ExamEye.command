#!/bin/bash
# ExamEye installer for macOS. If double-clicking says it cannot be executed, open Terminal and run:
#   bash "/Volumes/<pen drive>/exameye-installer/Install-ExamEye.command"
set -e
: "${HOME:?HOME is not set; cannot tell where to install}"
SRC="$(cd "$(dirname "$0")" && pwd)/ExamEye"
DEST="$HOME/ExamEye"
NEW="$DEST.new"
OLD="$DEST.old"
STATE="$HOME/Downloads/ExamEye-updater/state.txt"
REINSTALL=
# a run that died between the two renames of the swap left the live folder under the .old name
[ -d "$DEST" ] || { [ -d "$OLD" ] && mv "$OLD" "$DEST"; } || true
echo
echo "ExamEye installer"
echo "================="
if [ ! -f "$SRC/manifest.json" ]; then
  echo "The ExamEye folder was not found next to this file. Looked for:"
  echo "  $SRC/manifest.json"
  echo "Extract the whole zip first, then run Install-ExamEye.command from the extracted folder."
  exit 1
fi
if [ -f "$DEST/manifest.json" ]; then
  REINSTALL=1
  echo "ExamEye is already installed at $DEST; replacing it."
elif [ -e "$DEST" ]; then
  echo "A folder named $DEST already exists but is not ExamEye. Move it away by hand, then run this installer again."
  exit 1
fi
# a reinstall while an exam is running would swap files under the recording; the marker is the
# same one update-exameye.sh trusts. No browser process at all means no exam.
if [ -n "$REINSTALL" ] && (pgrep -xq 'Google Chrome' || pgrep -xq 'Microsoft Edge'); then
  state=$(head -n 1 "$STATE" 2>/dev/null || true)
  if [ "$state" = ARMED ] || [ "$state" = CLOSING ]; then
    echo "An exam is running on this PC (ExamEye reports $state). Wait for it to end, then run this installer again."
    exit 1
  fi
fi
verify_dir() {
  for f in manifest.json src/sw.js src/popup/popup.html src/options/options.html; do
    [ -e "$1/$f" ] || { echo "The folder is incomplete: $1/$f is missing."; return 1; }
  done
}
echo "Copying ExamEye to $DEST (Chrome loads it from there, so the pen drive or the extracted folder can go afterwards)."
rm -rf "$NEW"
mkdir -p "$NEW"
cp -R "$SRC/." "$NEW/" || { rm -rf "$NEW"; echo "Copy failed."; exit 1; }
verify_dir "$NEW" || { rm -rf "$NEW"; exit 1; }
echo
SEAT=
while [[ ! "$SEAT" =~ ^[A-Za-z0-9_-]+$ ]]; do
  [ -z "$SEAT" ] || echo "Use letters, digits, - and _ only."
  read -r -p "Seat or centre ID for this desk: " SEAT || { echo "No seat ID given."; rm -rf "$NEW"; exit 1; }
done
printf '%s\n' "$SEAT" > "$NEW/seat.txt"
inuse() {
  if [ -f "$DEST/manifest.json" ]; then
    rm -rf "$NEW"
  fi
  echo "ExamEye at $DEST is in use and could not be replaced; nothing was changed."
  echo "Close Chrome and Edge (check the menu bar; Edge keeps running in the background), then run this installer again."
  exit 1
}
halfswapped() {
  echo "The swap stopped half-way: the previous ExamEye is at $OLD and the new copy at $NEW."
  echo "Close Chrome and Edge, then run this installer again; it puts the previous folder back first."
  exit 1
}
# two renames, as in update-exameye.sh - a failure anywhere leaves the live folder untouched
if [ -n "$REINSTALL" ]; then
  rm -rf "$OLD"
  mv "$DEST" "$OLD" || inuse
  mv "$NEW" "$DEST" || { mv "$OLD" "$DEST" || halfswapped; inuse; }
  rm -rf "$OLD" || true
else
  mv "$NEW" "$DEST" || inuse
fi
verify_dir "$DEST" || exit 1
printf '%s' "$DEST" | pbcopy || true
register_updater() {
  UPD="$HOME/ExamEye-updater"
  mkdir -p "$UPD" "$HOME/Library/LaunchAgents" || return 1
  cp "$(dirname "$SRC")/update-exameye.sh" "$UPD/update-exameye.sh" || return 1
  chmod +x "$UPD/update-exameye.sh" || return 1
  PL="$HOME/Library/LaunchAgents/in.exameye.update.plist"
  cat > "$PL" <<PLIST || return 1
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>in.exameye.update</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$UPD/update-exameye.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>StartCalendarInterval</key><dict><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$UPD/launchd.log</string>
  <key>StandardErrorPath</key><string>$UPD/launchd.log</string>
</dict></plist>
PLIST
  launchctl bootout "gui/$(id -u)/in.exameye.update" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PL" 2>/dev/null || launchctl load "$PL"
}
if register_updater; then
  echo "Automatic updates registered (launchd agent in.exameye.update: at login and on the hour; it replaces ExamEye while Chrome is closed or ExamEye is idle)."
else
  echo "Could not register the hourly update agent. ExamEye still works; updates will need a re-install."
fi
open -a "Google Chrome" "chrome://extensions" 2>/dev/null || open -a "Microsoft Edge" "edge://extensions" || echo "Open Chrome and go to chrome://extensions yourself."
if [ -n "$REINSTALL" ]; then
  cat <<MSG

Chrome loads the new version from the same folder at its next start. If Chrome was open,
ExamEye reloads itself within a minute while idle, or right after the exam ends. Check that
the ExamEye popup shows "Installed version" with the new number. Saved settings are kept;
if the seat ID is wrong, change it on the setup page (ExamEye - Details - Extension options).
MSG
  exit 0
fi
cat <<MSG

Chrome is opening its Extensions page. Three clicks left:
  1. Switch on "Developer mode" (top right).
  2. Click "Load unpacked".
  3. In the file dialog press Command-Shift-G, paste the folder path (already on the clipboard) and click "Select":
     $DEST

The ExamEye setup page then opens by itself with everything filled in.
Check the seat ID ($SEAT) and click "Save settings".

Afterwards, on the same Extensions page: ExamEye - Details - "Allow in Incognito": on.
In Chrome Settings - Downloads: "Ask where to save each file before downloading": off.
macOS only: System Settings - Privacy & Security - Screen Recording - enable Chrome, then quit and reopen Chrome.
MSG
