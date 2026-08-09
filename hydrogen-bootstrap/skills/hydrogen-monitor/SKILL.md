---
name: hydrogen-monitor
description: >
  Use when the AI needs to watch the Hydrogen workspace in real-time — react to
  tab changes, sharing state, user actions, or any workspace mutation as it
  happens. Covers the SSE event stream, Monitor tool patterns, and example
  scripts. For point-in-time checks, GET /workspace/health and the control-port
  GET /workspace/tabs / /workspace/tabs/find are lighter than the proxy SSE.
  Trigger words: watch workspace, react to tab change, wait until user opens X,
  workspace event, SSE event, monitor tool, on tab change, real-time react,
  react to workspace changes, wait for sharing, watch for new panel,
  workspace_updated, monitor hydrogen, live workspace events.
---

# Hydrogen Real-Time Monitoring

Watch the Hydrogen workspace in real-time using Claude Code's Monitor tool + Hydrogen's SSE event stream. React to user actions as they happen — no polling, no "tell me when you're done."

## When to use

- You need to **wait for the user to do something** (enable sharing, open a panel, switch tabs)
- You want to **react to workspace changes** as they happen (auto-screenshot new panels, navigate web views)
- You're running a **multi-step demo** and need to know when the user is ready for the next step
- You want to **watch for errors** or state changes during a long-running task

## When NOT to use

- **One-shot waits** → use `--wait-for-sharing` on screenshot commands instead
- **Checking current state** → use `workspace tabs` or `screenshot status` directly
- **Short operations** → just run the command and check the result

## Lighter than SSE for point-in-time checks

The proxy SSE stream below is for *reacting continuously*. If you just need a
snapshot of current state, the **control port** (`$(cat ~/.adom/hydrogen-control-url)`,
i.e. `http://127.0.0.1:<dynamic>` — same loopback from the workspace and the host
via WSL2 mirrored networking) has cheaper reads:

- `GET /workspace/health` — deep workspace health (distro + code-server + host reachability)
- `GET /workspace/tabs` — list all workspace tabs right now
- `GET /workspace/tabs/find?name=X` — does a named tab exist (404 if not)

Use these in a poll loop when SSE would be overkill. See **hydrogen-api** for the full
control-port surface.

## The SSE endpoint

```text
GET /api/workspaces/editor/{owner}/{repo}/current/events
Header: X-Api-Key: <token>
```

Emits:
- `{"type": "connected"}` — once on connect
- `{"type": "workspace_updated"}` — on every workspace mutation (tab add/remove, split, resize, active tab change, panel state change)

The events don't include details about *what* changed — query `workspace tabs` or other endpoints after receiving an event to see the current state.

## Basic monitor: watch for workspace changes

```bash
# Monitor tool script — reports tab changes in real-time.
# Inside an Hydrogen workspace, talk to the LOCAL Hydrogen workspace API, not cloud hostnames:
# derive the base from ADOM_CARBON_URL / ADOM_HYDROGEN_URL (they point at
# http://127.0.0.1:<proxy>). The Hydrogen-local slug is always `hdlocal`.
API_KEY=$(cat /var/run/adom/api-key)
CARBON="${ADOM_CARBON_URL:-http://127.0.0.1:47083}"
HYDROGEN="${ADOM_HYDROGEN_URL:-$CARBON}"
SLUG="hdlocal"
INFO=$(curl -s -H "Authorization: Bearer $API_KEY" "$CARBON/containers/$SLUG")
OWNER=$(echo "$INFO" | python3 -c "import sys,json; print(json.load(sys.stdin)['repository']['owner']['name'])")
REPO=$(echo "$INFO" | python3 -c "import sys,json; print(json.load(sys.stdin)['repository']['name'])")
BASE="$HYDROGEN/api/workspaces/editor/$OWNER/$REPO/current"
LAST=""

curl -s -N -H "X-Api-Key: $API_KEY" "$BASE/events" 2>/dev/null | while IFS= read -r line; do
  cleaned=$(echo "$line" | sed 's/^data: //')
  [ -z "$cleaned" ] && continue
  type=$(echo "$cleaned" | python3 -c "import sys,json; print(json.load(sys.stdin).get('type',''))" 2>/dev/null)
  [ -z "$type" ] && continue

  if [ "$type" = "workspace_updated" ]; then
    NOW=$(curl -s -H "X-Api-Key: $API_KEY" "$BASE/tabs" 2>/dev/null | python3 -c "
import sys,json
tabs=json.load(sys.stdin).get('tabs',[])
names=[t['name'] for t in tabs]
active=[t['name'] for t in tabs if t.get('isActive')]
print(f'tabs: {len(names)} — {\", \".join(names)} | active: {\", \".join(active)}')
" 2>/dev/null)
    if [ "$NOW" != "$LAST" ] && [ -n "$NOW" ]; then
      echo "[workspace] $NOW"
      LAST="$NOW"
    fi
  elif [ "$type" = "connected" ]; then
    echo "[connected] Monitoring $OWNER/$REPO"
  fi
done
```

Use with the Monitor tool:
```text
Monitor(description: "Hydrogen workspace events", persistent: true, command: "<script above>")
```

## Simpler: use adom-cli in the monitor

For lighter-weight monitoring, use `adom-cli` commands inside a poll loop instead of the SSE stream:

```bash
# Poll sharing status every 5s until it activates
while true; do
  STATUS=$(adom-cli hydrogen screenshot status 2>/dev/null)
  ACTIVE=$(echo "$STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('sharing',{}).get('active',False))" 2>/dev/null)
  if [ "$ACTIVE" = "True" ]; then
    echo "[sharing] Screen sharing activated"
    break
  fi
  sleep 5
done
```

```bash
# Watch for a specific tab to appear
while true; do
  adom-cli hydrogen workspace find-tab "Schematic Editor" >/dev/null 2>&1 && {
    echo "[found] Schematic Editor tab is open"
    break
  }
  sleep 2
done
```

## Reactive patterns

### Auto-screenshot new panels
When the monitor detects a new tab, automatically screenshot it:

```bash
# In your monitor's workspace_updated handler:
if [ "$NOW" != "$LAST" ]; then
  # A new tab appeared — find it and screenshot
  NEW_TAB=$(diff <(echo "$LAST") <(echo "$NOW") | grep "^>" | head -1)
  echo "[new] $NEW_TAB — taking screenshot"
  adom-cli hydrogen screenshot workspace >/dev/null 2>&1
fi
```

### Wait for sharing then capture
Instead of `--wait-for-sharing`, use a monitor for more control:

```bash
# Monitor until sharing activates, then take all the screenshots you need
while true; do
  ACTIVE=$(adom-cli hydrogen screenshot status 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('sharing',{}).get('active',False))" 2>/dev/null)
  if [ "$ACTIVE" = "True" ]; then
    echo "[ready] Sharing active — capturing"
    adom-cli hydrogen screenshot workspace
    adom-cli hydrogen screenshot panel --name "Schematic Editor"
    break
  fi
  sleep 2
done
```

## Best practices

1. **Use `persistent: true`** for session-length watches (workspace monitoring, demo flows)
2. **Filter events** — don't echo every `workspace_updated`, only report when state actually changes (diff against last known state)
3. **Use `--line-buffered`** with grep in pipes so events arrive immediately
4. **Handle connection drops** — the SSE stream can timeout; wrap in a reconnect loop if needed
5. **Prefer `--wait-for-sharing`** for simple "wait then screenshot" — Monitor is for when you need to react to multiple events or do complex logic
6. **Don't spam** — if the monitor emits too many events, Claude Code auto-stops it. Keep output selective

## Monitor vs other approaches

| Need | Approach |
|------|----------|
| Wait for sharing, then screenshot | `screenshot workspace --wait-for-sharing 30` |
| Check current state once | `screenshot status`, `workspace tabs`, `audio status` |
| React to workspace changes in real-time | **Monitor + SSE stream** |
| Run a multi-step demo with user interaction | **Monitor** — watch for user actions between steps |
| Poll until a condition is met | **Monitor** with a poll loop + `break` |
| Long-running background task with status | `Bash` with `run_in_background` |
