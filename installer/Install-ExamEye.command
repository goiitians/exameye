#!/bin/bash
# ExamEye installer for macOS. If double-clicking says it cannot be executed, open Terminal and run:
#   bash "/Volumes/<pen drive>/exameye-installer/Install-ExamEye.command"
set -e
SRC="$(cd "$(dirname "$0")" && pwd)/ExamEye"
DEST="$HOME/ExamEye"
echo
echo "ExamEye installer"
echo "================="
echo "Copying ExamEye to $DEST (Chrome loads it from there, so the pen drive can be removed afterwards)."
mkdir -p "$DEST"
cp -R "$SRC/." "$DEST/"
echo
read -r -p "Seat or centre ID for this desk [C01]: " SEAT
SEAT="${SEAT:-C01}"
sed -i '' "s/\"seat\": *\"[^\"]*\"/\"seat\": \"$SEAT\"/" "$DEST/defaults.json"
printf '%s' "$DEST" | pbcopy
open -a "Google Chrome" "chrome://extensions" 2>/dev/null || open -a "Microsoft Edge" "edge://extensions"
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
