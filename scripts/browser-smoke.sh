#!/usr/bin/env bash
set -euo pipefail

PORT=4173
python3 -m http.server "$PORT" --bind 127.0.0.1 >/tmp/rift-http.log 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

for _ in {1..20}; do
  if curl -fsS "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then break; fi
  sleep 0.25
done

CHROME="$(command -v google-chrome || command -v google-chrome-stable || command -v chromium || command -v chromium-browser || true)"
if [[ -z "$CHROME" ]]; then
  echo "Chrome/Chromium is not available on this runner."
  exit 1
fi

smoke_route() {
  local route="$1"
  local expected="$2"
  local safe_route
  safe_route="$(printf '%s' "$route" | tr -cd '[:alnum:]_-')"
  local dom="/tmp/rift-$safe_route.html"
  local err="/tmp/rift-$safe_route.err"

  "$CHROME"     --headless=new     --no-sandbox     --disable-gpu     --disable-dev-shm-usage     --virtual-time-budget=1200     --dump-dom "http://127.0.0.1:$PORT/#$route" >"$dom" 2>"$err"

  if ! grep -Fq "$expected" "$dom"; then
    echo "Route #$route did not render expected text: $expected"
    cat "$dom"
    exit 1
  fi

  if grep -Eqi 'Uncaught|ReferenceError|TypeError|SyntaxError' "$err"; then
    echo "JavaScript error detected on #$route"
    cat "$err"
    exit 1
  fi

  echo "PASS #$route"
}

smoke_route "home" "Welcome back"
smoke_route "account" "RIFT ACCOUNT"
smoke_route "team" "My Team"
smoke_route "schedule" "Schedule"
smoke_route "players" "Players"
smoke_route "league" "League"
smoke_route "transactions" "Waivers &amp; Transactions"
smoke_route "trade" "Trades"
smoke_route "draft" "Draft Room"
smoke_route "setup" "League Setup"
smoke_route "matchup" "Matchup"
smoke_route "not-a-real-route" "Welcome back"

echo "Browser smoke tests passed."
