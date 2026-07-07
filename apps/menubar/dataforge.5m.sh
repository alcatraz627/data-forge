#!/usr/bin/env bash
#
# Data Forge menu bar plugin for SwiftBar (or xbar). Shows today's agenda in
# the Mac menu bar and offers one-keystroke capture, both against the local
# forge-server. The filename's "5m" sets the refresh interval; a note captured
# here shows on every device within a sync cycle.
#
# Install: brew install swiftbar, then symlink this file into the SwiftBar
# plugin folder (chmod +x it first). Override the server with FORGE_URL.
set -euo pipefail
FORGE_URL="${FORGE_URL:-http://localhost:5040}"
SELF="$0"

# Subcommand: pop a capture dialog and POST it. Invoked by the menu item.
if [ "${1:-}" = "capture" ]; then
  body=$(osascript -e 'text returned of (display dialog "New note" default answer "" with title "Data Forge")' 2>/dev/null || true)
  [ -z "$body" ] && exit 0
  json=$(BODY="$body" python3 -c 'import json,os;print(json.dumps({"body":os.environ["BODY"],"source":"menubar"}))')
  curl -fsS -X POST "$FORGE_URL/api/docs" -H 'content-type: application/json' -d "$json" >/dev/null 2>&1 \
    && osascript -e 'display notification "Saved to Data Forge"' \
    || osascript -e 'display notification "Save failed — is the server running?"'
  exit 0
fi

# Subcommand: mark a reminder done (docId + reminder index passed by the item).
if [ "${1:-}" = "done" ]; then
  curl -fsS "$FORGE_URL/api/reminders/complete?doc=$2&index=$3" -X POST >/dev/null 2>&1 || true
  exit 0
fi

# Default: render the menu. The agenda JSON is produced by the server so the
# recurrence math lives in one place (see /api/agenda).
agenda=$(curl -fsS --max-time 2 "$FORGE_URL/api/agenda" 2>/dev/null || echo "")

if [ -z "$agenda" ]; then
  echo "⏰ ⚠"
  echo "---"
  echo "Data Forge server not reachable | color=red"
  echo "Start it: make deploy | font=Menlo"
  exit 0
fi

count=$(echo "$agenda" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)["entries"]))')
overdue=$(echo "$agenda" | python3 -c 'import sys,json;print(sum(1 for e in json.load(sys.stdin)["entries"] if e["overdue"]))')

if [ "$overdue" -gt 0 ]; then
  echo "⏰ $overdue | color=orange"
else
  echo "⏰ $count"
fi
echo "---"
echo "New note… | bash=\"$SELF\" param1=capture terminal=false refresh=true"
echo "Open Data Forge | href=$FORGE_URL"
echo "---"

if [ "$count" -eq 0 ]; then
  echo "Nothing scheduled | color=gray"
else
  # Each item is a submenu: the line opens the app; a nested action marks the
  # reminder done via the API (which rolls a recurring one forward).
  echo "$agenda" | SELF="$SELF" FORGE_URL="$FORGE_URL" python3 -c '
import sys, json, os
from datetime import datetime
data = json.load(sys.stdin)
self_path, url = os.environ["SELF"], os.environ["FORGE_URL"]
for e in data["entries"][:12]:
    try:
        t = datetime.fromisoformat(e["at"].replace("Z", "+00:00")).astimezone()
        when = t.strftime("%-d %b %H:%M")
    except Exception:
        when = e["at"]
    color = "orange" if e["overdue"] else "white"
    title = e["title"][:40].replace("|", "-")
    print(f"{when}  {title} | color={color} href={url}")
    print(f'"'"'--✓ mark done | bash="{self_path}" param1=done param2={e["docId"]} param3={e["reminderIndex"]} terminal=false refresh=true'"'"')
'
fi
