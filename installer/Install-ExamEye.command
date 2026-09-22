#!/bin/bash
# ExamEye installer for macOS. If double-clicking says it cannot be executed, open Terminal and run:
#   bash "/Volumes/<pen drive>/exameye-installer/Install-ExamEye.command"
set -e
: "${HOME:?HOME is not set; cannot tell where to install}"
SRC="$(cd "$(dirname "$0")" && pwd)/ExamEye"
DEST="$HOME/ExamEye"
REINSTALL=
echo
echo "ExamEye installer"
echo "================="
# An earlier install is replaced whole (agent, folders), so no file from an older version
# survives. Chrome must be quit: deleting the folder it has loaded fails half-way.
if [ -f "$DEST/manifest.json" ]; then
  REINSTALL=1
  echo "ExamEye is already installed at $DEST; replacing it."
  if pgrep -xq 'Google Chrome' || pgrep -xq 'Microsoft Edge'; then
    echo "Chrome is open. Quit it, then run this installer again."
    exit 1
  fi
  launchctl bootout "gui/$(id -u)/in.exameye.update" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/in.exameye.update.plist"
  rm -rf "$DEST" "$DEST.new" "$DEST.old" "$HOME/ExamEye-updater"
fi
echo "Copying ExamEye to $DEST (Chrome loads it from there, so the pen drive can be removed afterwards)."
mkdir -p "$DEST"
cp -R "$SRC/." "$DEST/"
echo
read -r -p "Seat or centre ID for this desk [C01]: " SEAT
SEAT="${SEAT:-C01}"
sed -i '' "s/\"seat\": *\"[^\"]*\"/\"seat\": \"$SEAT\"/" "$DEST/defaults.json"
printf '%s' "$DEST" | pbcopy
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
  <key>StartInterval</key><integer>3600</integer>
  <key>StandardOutPath</key><string>$UPD/launchd.log</string>
  <key>StandardErrorPath</key><string>$UPD/launchd.log</string>
</dict></plist>
PLIST
  launchctl bootout "gui/$(id -u)/in.exameye.update" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PL" 2>/dev/null || launchctl load "$PL"
}
if register_updater; then
  echo "Automatic updates registered (launchd agent in.exameye.update: at login and hourly; it replaces ExamEye while Chrome is closed or ExamEye is idle)."
else
  echo "Could not register the hourly update agent. ExamEye still works; updates will need a re-install."
fi
open -a "Google Chrome" "chrome://extensions" 2>/dev/null || open -a "Microsoft Edge" "edge://extensions"
if [ -n "$REINSTALL" ]; then
  cat <<MSG

Chrome is starting. ExamEye was already loaded from $DEST, so there is nothing to click:
Chrome loads the new version from the same folder. Check that the ExamEye popup shows
"Installed version" with the new number. Saved settings are kept; if the seat ID is wrong,
change it on the setup page (ExamEye - Details - Extension options).
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
