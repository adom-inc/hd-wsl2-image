---
name: hd-workspace-lifecycle
description: WSL2 distro (`Adom-Workspace`) lifecycle management for Hydrogen Desktop on Windows. Import/export/unregister/terminate, code-server-as-HD-child, the resume reality-check, recovery after sleep/hibernate, and every hard-won rule about what NOT to do — above all, NEVER run global WSL operations; touch ONLY Adom-Workspace so a co-installed Docker Desktop WSL integration stays safe. MUST READ before any workspace operation. Trigger words — wsl, workspace, distro, Adom-Workspace, restart workspace, terminate distro, unregister, wsl --import, wsl --unregister, code-server, workspace broken, workspace unhealthy, wsl hung, fix workspace, /wsl/status.
---

# Hydrogen Desktop — WSL2 Workspace Lifecycle

> This is the WSL2-runtime version (default). The legacy Docker equivalent
> (`HD_RUNTIME=docker`) is in the docker/ bucket.

Under the WSL2 runtime the workspace is the **`Adom-Workspace` distro** (Ubuntu,
imported with `wsl --import`), running locally on the user's Windows machine.
`/home/adom/project` lives inside the distro — there is no Docker volume.

## ABSOLUTE RULE — NEVER touch global WSL state

**Operate ONLY on `Adom-Workspace`. Never run any global / cross-distro WSL command.**

Forbidden, no exceptions:
- ❌ `wsl --shutdown` (kills the entire WSL utility VM and every distro)
- ❌ `wsl --terminate` on any distro other than `Adom-Workspace`
- ❌ blanket killing of `wsl.exe` processes
- ❌ restarting the WSL service / utility VM
- ❌ `wsl --unregister` on anything but `Adom-Workspace`

**Why this matters:** the user may already run Docker Desktop, which cross-mounts a
proxy into every distro via the shared `/mnt/wsl` namespace
(`/mnt/wsl/docker-desktop/docker-desktop-user-distro`). Any global WSL teardown makes
that path vanish and pops a "Docker Desktop - Ubuntu: WSL integration unexpectedly
stopped" dialog. It's harmless to HD's own `Adom-Workspace`, but it looks to the user
like HD broke their Docker — terrible first-run UX. So every HD operation must be
scoped to `Adom-Workspace` and nothing else.

Allowed, scoped operations:
- ✅ `wsl --terminate Adom-Workspace` (this is what "Restart" does)
- ✅ `wsl --unregister Adom-Workspace` (destructive wipe, this distro only)
- ✅ `wsl --import Adom-Workspace <dir> <tarball>` (fresh import)
- ✅ `wsl -d Adom-Workspace -u adom -- <cmd>` (exec inside the distro)

## In-distro exec — NEVER `docker exec`

To run a command inside the workspace:
```bash
wsl -d Adom-Workspace -u adom -- <cmd>
# or
wsl -d Adom-Workspace -u adom -- su - adom -c '...'
```
There is no `docker exec` under this runtime, and no Docker container to exec into.

## Workspace Lifecycle

### Import (fresh setup)
`setup_and_start` → `WslDistroRuntime::setup_and_start` → `fresh_import`:
download `adom-golden.tar.gz` (the full pre-baked golden image, downloaded
anonymously from the `adom-inc/hd-wsl2-image` GitHub release, SHA256-verified)
then `wsl --import Adom-Workspace <dir> adom-golden.tar.gz`, then start code-server.
Log proof: `[wsl-tarball] downloaded … SHA256 OK` → `[setup] WSL setup_and_start completed`
and `wsl -l -v` shows `Adom-Workspace  Running  2`.

### code-server is an HD-OWNED CHILD process
code-server (`CODE_SERVER_CHILD` in `runtime/wsl.rs`) runs as a child of HD, deliberately
tied to HD's lifetime — **NOT a detached `nohup`** (a detached process dies when WSL
tears down the session anyway). Consequence: every HD restart (rebuild / crash /
relaunch) orphans the old code-server, so a fresh HD can come up with the distro
`Running` but the editor DEAD ("Starting AI Environment" forever) even when setup is
otherwise complete.

Fix (already in HD): HD **re-ensures code-server on every launch**
(`[wsl-startup] re-ensured code-server on launch`). And the resume reality-check in
`run_all_wsl` requires code-server reachable on the host port **7380** — not just
"distro registered" — before it trusts the workspace as ready.

### Restart
"Restart Workspace" = `wsl --terminate Adom-Workspace` + re-ensure code-server.
NOT `docker restart`. This is the fix for a workspace that's gone unreachable after
laptop sleep/hibernate.

### Stop
`wsl --terminate Adom-Workspace`. The distro stays registered (and your project files
persist); it just isn't Running.

### Export / backup
`wsl --export Adom-Workspace <file>.tar` snapshots the distro to a tarball. Re-import
with `wsl --import Adom-Workspace <dir> <file>.tar`. (Scoped to this distro, so safe.)

### Unregister (DESTRUCTIVE wipe)
`wsl --unregister Adom-Workspace` — deletes the distro AND everything in it, including
`/home/adom/project`. This is the only destructive wipe, and it names ONLY
`Adom-Workspace`. Never unregister any other distro.

## Control API

The HD control API is on loopback **`http://127.0.0.1:<dynamic>`** (NOT 9001). The
port is dynamic per launch — read the live URL from `~/.adom/hd-control-url`. From
inside the distro, reach the host at the same `127.0.0.1` URL: WSL2 mirrored
networking shares loopback with the Windows host.

| Endpoint | What it does |
|---|---|
| `GET /wsl/status` | Reports `Adom-Workspace` state — registered? Running? code-server reachable on :7380? |
| `POST /wsl/unregister` | Destructive: `wsl --unregister Adom-Workspace` (this distro only) |
| `GET /container-stats` | Live CPU/RAM/disk from the `workspace_stats()` probe (see hd-container-stats) |

```bash
BASE="$(cat ~/.adom/hd-control-url)"   # http://127.0.0.1:<dynamic>

# Workspace status (from inside the distro)
curl -s "$BASE/wsl/status"

# Destructive wipe of ONLY Adom-Workspace
curl -s -X POST "$BASE/wsl/unregister"
```

## Diagnosing Workspace Problems

### "Workspace unhealthy" / editor stuck on "Starting AI Environment"
- **Cause**: code-server child was orphaned by an HD restart, or the distro went
  unreachable after sleep.
- **Check**: `[wsl] Workspace unhealthy …` in the HD log (the real signal). NOTE: a
  `[docker] Container runtime unhealthy …` line under WSL is **benign noise** — a
  leftover heartbeat with no container bound. Ignore it; look at the `[wsl]` line.
- **Fix**: Restart Workspace (Adom menu) = `wsl --terminate Adom-Workspace` + re-ensure
  code-server. Verify code-server answers on :7380.

### Distro `Running` but editor dead
- **Cause**: code-server (HD's child) isn't up even though `wsl -l -v` shows Running.
- **Fix**: relaunch HD (it re-ensures code-server on launch), or Restart Workspace.
  Confirm via the resume reality-check — code-server reachable on :7380, not just
  "distro registered."

### WSL2 not available at all
- **Cause**: WSL2 isn't installed/enabled on the machine.
- **Fix**: the "WSL2 Not Available" floaty → "Run Setup Steps" walks the user through
  enabling it. See [hd-workspace-monitoring](../hd-workspace-monitoring/SKILL.md).

## Recovery Checklist

When the workspace is broken, follow this order:

1. **Check WSL2 itself**: `wsl --status` (NOT `wsl --shutdown`).
2. **Check the distro**: `wsl -l -v` — is `Adom-Workspace` listed and Running?
3. **If Running but editor dead**: code-server child orphaned → Restart Workspace
   (`wsl --terminate Adom-Workspace` + re-ensure code-server), or relaunch HD.
4. **Verify code-server**: it must answer on host :7380 (the resume reality-check).
5. **Last resort (destructive)**: `wsl --unregister Adom-Workspace` then re-import via
   `setup_and_start` — wipes the distro and re-imports `adom-golden.tar.gz`.
6. **NEVER** reach for global WSL ops to "fix" things — that breaks co-installed Docker
   Desktop, doesn't help your distro, and angers the user.

## What NOT To Do (learned the hard way)

- Do NOT run `wsl --shutdown` — global, kills every distro, breaks Docker Desktop's
  WSL integration.
- Do NOT `wsl --terminate` or `wsl --unregister` any distro except `Adom-Workspace`.
- Do NOT blanket-kill `wsl.exe` — same blast radius as `--shutdown`.
- Do NOT use `docker exec` / `docker restart` — there is no container in this runtime.
- Do NOT trust "distro registered" as healthy — require code-server reachable on :7380.
- Do NOT treat `[docker] … unhealthy` in the log as a real failure under WSL — it's
  benign; the real signal is `[wsl] Workspace unhealthy …`.

## Related skills

- [hd-workspace-monitoring](../hd-workspace-monitoring/SKILL.md) — the 15s poll, floaty states, lifecycle dialog, auto-start
- [hd-container-stats](../hd-container-stats/SKILL.md) — title-bar CPU/RAM bars + `workspace_stats()` probe
- [hd-networking](../hd-networking/SKILL.md) — port 7380 code-server, control port 47084, host reachability
