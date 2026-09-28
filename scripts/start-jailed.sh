#!/bin/sh
# Start the server inside a nono jail. The flags below are the server's
# sandbox profile: what it may read (its own code, the registry, each wiki),
# what it may write (each wiki's machine-local runtime tree, for the trace
# row every CLI call files), and that it may listen on one loopback port and
# reach nothing else on the network.
#
# The wiki list comes from the machine registry at start, so a wiki
# registered later needs a restart. Requires: nono, node >= 24, llm-wiki-cli.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
CLI=${DASHBOARD_CLI:-llm-wiki-cli}
PORT=${DASHBOARD_PORT:-4180}

if ! command -v nono >/dev/null 2>&1; then
  echo "nono is not installed; run without a jail: npm start" >&2
  exit 2
fi

CLI_BIN=$(command -v "${CLI%% *}") || { echo "cannot find $CLI on PATH" >&2; exit 2; }
CLI_REAL=$(readlink "$CLI_BIN" 2>/dev/null || echo "$CLI_BIN")
case "$CLI_REAL" in /*) ;; *) CLI_REAL="$(dirname "$CLI_BIN")/$CLI_REAL" ;; esac
# A console script lives in <venv>/bin; the whole venv must be readable.
CLI_HOME=$(cd "$(dirname "$CLI_REAL")/.." && pwd)

REGISTRY_DIR=${XDG_CONFIG_HOME:-$HOME/.config}/llm-wiki
STATE_DIR=${XDG_STATE_HOME:-$HOME/.local/state}/llm-wiki

NODE_BIN=$(command -v node)
NODE_HOME=$(cd "$(dirname "$(readlink -f "$NODE_BIN")")/.." && pwd)

set -- \
  --block-net \
  --open-port "$PORT" \
  --read "$ROOT" \
  --read "$NODE_HOME" \
  --read "$CLI_HOME" \
  --read "$REGISTRY_DIR" \
  --read "$STATE_DIR" \
  --allow "${TMPDIR:-/tmp}"

# An editable install keeps the CLI's code outside its venv; each .pth line
# that names a directory gets a read grant.
for pth in "$CLI_HOME"/lib/python*/site-packages/*.pth; do
  [ -f "$pth" ] || continue
  while IFS= read -r line; do
    case "$line" in /*) [ -d "$line" ] && set -- "$@" --read "$line" ;; esac
  done < "$pth"
done

# One read grant per wiki, plus a write grant on its runtime tree.
WIKIS=$("$CLI" machine wikis ls --json | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    for (const w of JSON.parse(s).wikis) console.log(w.path)
  })')
for w in $WIKIS; do
  set -- "$@" --read "$w" --write "$w/.llm-wiki.local/runtime"
done

TOKEN=${DASHBOARD_TOKEN:-$(node -e 'console.log(require("crypto").randomBytes(24).toString("base64url"))')}
URL="http://127.0.0.1:$PORT/?token=$TOKEN"

echo "jail: nono run $*"
echo "open: $URL"
if [ "${DASHBOARD_OPEN:-1}" != "0" ]; then
  (sleep 2; case "$(uname)" in Darwin) open "$URL";; *) xdg-open "$URL" 2>/dev/null || true;; esac) &
fi

cd "$ROOT"
exec env DASHBOARD_TOKEN="$TOKEN" DASHBOARD_OPEN=0 DASHBOARD_PORT="$PORT" LLM_WIKI_PERMISSIONS=read \
  nono run "$@" -- node --import tsx server/src/index.ts
