#!/bin/sh
# Build the UI for the Raspberry Pi: pi-ui/, a plain folder of files -- the Pi
# needs no Node. Renders the page once with the node build and saves it
# (this template cannot build a static site directly -- see README).
set -e
cd "$(dirname "$0")/.."
PORT=${SNAPSHOT_PORT:-3999}

# A server already on this port would answer instead of ours and we would save
# the OLD page against the NEW files -- an unstyled, broken UI on the Pi.
if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port $PORT is busy (an old UI server?). Stop it, or: SNAPSHOT_PORT=4999 $0"; exit 1
fi

NITRO_PRESET=node-server npm run build
PORT=$PORT node .output/server/index.mjs >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
for i in $(seq 1 40); do curl -sf "http://localhost:$PORT/" >/dev/null && break; sleep 0.25; done

rm -rf pi-ui
cp -R .output/public pi-ui
curl -sf "http://localhost:$PORT/" -o pi-ui/index.html

# Every file the page asks for must be in the folder we ship.
for f in $(grep -aoE '/assets/[^"]+' pi-ui/index.html); do
  [ -f "pi-ui$f" ] || { echo "BROKEN: page wants $f but pi-ui has no such file"; exit 1; }
done
echo "pi-ui ready: $(du -sh pi-ui | cut -f1). Copy it to the Pi:"
echo "  rsync -av --delete pi-ui/ pi@<pi-ip>:~/mixmind-ui/"
