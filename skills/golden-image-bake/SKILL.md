---
name: golden-image-bake
description: "Rebuild + release the Hydrogen Desktop golden WSL2 rootfs image (adom-inc/hd-wsl2-image). Use when the user says \"bake the golden image\", \"rebuild the wsl2 image\", \"new golden image\", \"monthly image bake\", \"cut a new hd-wsl2-image version\", or when gallia/CLI/extension drift makes the shipped image stale (target cadence: monthly). EMPLOYEE-ONLY — needs an Adom cloud container with the private gallia + hydrogen-desktop checkouts; never publish this skill to gallia or the public image."
---

# Golden image bake — adom-inc/hd-wsl2-image

## 🔒 DESIGN GOALS — NON-NEGOTIABLE INVARIANTS (read before changing ANYTHING)

**THE overarching goal: Hydrogen Desktop must behave as close to Web Hydrogen
(the cloud Docker container) as possible.** Every golden-image decision is judged
against "does this match how Web Hydrogen works?" If a change would diverge HD's
behaviour from Web Hydrogen, it is almost certainly wrong.

1. **PORT ACCESS VIA `<host>/proxy/<port>/` MUST WORK — this is how Web Hydrogen
   exposes ports and HD MUST replicate it.** In Web Hydrogen, every forwarded port
   is reached through the cloud container's DNS address + `/proxy/<port>/`
   (e.g. `https://<slug>.adom.cloud/proxy/<port>/`). HD must serve the identical
   code-server path-proxy route so the same URLs work. **NEVER disable port
   forwarding or do anything that breaks the `/proxy/<port>/` route** (do not set
   `remote.autoForwardPorts:false` or otherwise kill it without proving the proxy
   route still works). This is in ADDITION to WSL2 **mirrored networking**, which
   also exposes WSL2 ports on the host's `localhost` — **BOTH must work.** (John has
   stated this requirement more than once — it is a core design goal, never forget it.)
   - PROVEN 2026-06-22: code-server's `/proxy/<port>/` route is a static HTTP route,
     **independent of `remote.autoForwardPorts`** — a port that was never auto-forwarded
     still serves via `/proxy/<port>/` on demand. So you may tune the auto-forward
     *settings* without breaking the proxy, but ALWAYS re-verify against a re-imported
     image (boot code-server, `python3 -m http.server N`, curl `…/proxy/N/`).
   - PARITY SETTING: the Web Hydrogen cloud container sets
     `"remote.autoForwardPortsSource": "hybrid"` (verified by reading the live container's
     code-server settings; its `VSCODE_PROXY_URI=…/proxy/{{port}}/`). The golden image
     MUST set the same — pinning the source to `hybrid` from the start means there is no
     `process→hybrid` switch, so the "Over 20 ports… switched to hybrid" popup never fires.
     Do NOT "fix" that popup by disabling auto-forward or with `autoForwardPortsFallback` —
     match Web Hydrogen with `autoForwardPortsSource: hybrid`.
2. **Clean first-load editor:** opens to an empty workbench — no Explorer sidebar,
   no bottom panel, no tabs, no welcome page (just the 48px activity-bar rail).
   Seeded per-workspace in hd-windows-bootstrap's workbench.html + `startupEditor:none`.
3. **No C/C++ build toolchain** — runtime image runs PRE-BUILT binaries (adompkg),
   nothing compiles at runtime; the toolchain is dead weight (Rust CLIs are built in
   the cloud/CI, not here). Keep code-server, node (adompkg needs it), gh, git, python3.
4. **Built from signed wiki.adom.inc adompkg bootstraps, NOT gallia.** One install:
   `adompkg install adom/hd-windows-bootstrap` → core + hd-bootstrap + WSL2 layer +
   updater + adom-desktop. No gallia clone / install.mjs / GALLIA_TOKEN in the image.
5. **WSL2-native bake, NEVER docker** (see [[feedback_golden_image_wsl2_never_docker]]).
6. **Workspace opens at `/home/adom`** (the home folder), not `/home/adom/project`
   — though the opened folder is ultimately an HD launch-time arg.

7. **Bootstrap script contract (learned the hard way, 2026-07-16):** the registry
   REQUIRES meta/bootstrap packages to use `scripts.postinstall` — publish validation
   rejects `scripts.install/uninstall` on them ("meta packages must not have
   scripts.install/uninstall"). The HD bootstraps' postinstall convention is CORRECT;
   do NOT try to "fix" them to install.sh. Known CLI gap: adom-wiki ≤1.0.41 never
   EXECUTES scripts.postinstall (adom/adom-wiki-cli issue #9) — the bake carries a
   guarded, self-disabling workaround that runs the two bootstrap postinstalls
   explicitly when the CLI didn't. Remove it only when issue #9 is fixed.

When in doubt about ANY of the above, VERIFY empirically against a re-imported image
(boot code-server, test the actual behaviour) before changing the bake — do not guess.

Rebuilds the flat WSL2 rootfs that Hydrogen Desktop `wsl --import`s, with
everything pre-baked (apt baseline, code-server, gallia, claude CLI,
Claude Code + adom-vscode extensions, VS Code settings, HD skills, Adom
CLIs, adom-desktop CLI), then publishes it as a GitHub Release asset.

Repo: `/home/adom/project/hd-wsl2-image` (github.com/adom-inc/hd-wsl2-image, public).
Canonical recipe: `image/Dockerfile`; the chroot builder
`scripts/build-rootfs.sh` is its docker-less translation (this container
has no docker) — **keep them in lockstep** when editing either.

## ✅ DONE (v8) — in-distro workspace-updater daemon baked

(Shipped in v8: systemd + systemd-sysv installed so PID 1 is systemd and the
timer fires; daemon at /usr/local/bin/adom-workspace-updater 0.1.2 + enabled
timer; Codex NOT baked — daemon installs it on first boot. The section below is
the reference for how it's wired.)

## (reference) workspace-updater daemon bake

**Gate: ONLY after `feature/hd-auto-update` is merged into hydrogen-desktop
`main`.** Check first: `git ls-tree -r --name-only origin/main -- \
src-tauri/crates/hd-app/resources/workspace-updater/` — if it returns the
files, the gate is open; if empty, SKIP this section (not merged yet).

HD now ships an in-distro auto-updater. HD bootstraps it into the distro on
every launch (`ensure_workspace_updater`), so existing AND new users get it
without an image change — baking it just means a fresh image has the daemon
present before HD's first launch. **Part C invariant (HOLD IT):** the golden
image is FIRST-INSTALL ONLY — never add anything that re-images or migrates
an existing user's distro. All ongoing updates flow through the daemon in
place; the image only benefits brand-new installs.

**KEEP everything currently baked** (code-server, claude-code extension,
adom-vscode, gallia, CLIs — all of it stays). The daemon does NOT replace
the bake. Its **first** update installs the **Codex VS Code extension**
(which we do NOT bake) and thereafter converges the container to the live
manifest (SHA-verified, never-downgrade, surgical):
`https://wiki.adom.inc/api/v1/pages/hd-workspace-tooling/files/manifest.json`

Source (hydrogen-desktop main, post-merge):
`src-tauri/crates/hd-app/resources/workspace-updater/`
  - `adom-workspace-updater.sh`      → `/usr/local/bin/adom-workspace-updater` (chmod +x)
  - `adom-workspace-updater.service` → `/etc/systemd/system/`
  - `adom-workspace-updater.timer`   → `/etc/systemd/system/` (then `systemctl enable`)
  - `README.md` — reference only, do NOT ship into the image

Implementation (apply when the gate opens), in lockstep across all three:
1. **CI** `.github/workflows/build.yml` — extend the HD sparse-checkout to
   also stage the updater dir alongside `skills/public-facing`, copy it to
   `image/workspace-updater/`.
2. **chroot** `scripts/build-rootfs.sh` — stage from the local checkout:
   `sudo cp -r ~/project/hydrogen-desktop/src-tauri/crates/hd-app/resources/workspace-updater "${ROOT}/tmp/"`
3. **`image/bake-hd-setup.sh`** — new step (runs as root):
   ```bash
   install -m 0755 /tmp/workspace-updater/adom-workspace-updater.sh /usr/local/bin/adom-workspace-updater
   install -m 0644 /tmp/workspace-updater/adom-workspace-updater.service /etc/systemd/system/
   install -m 0644 /tmp/workspace-updater/adom-workspace-updater.timer   /etc/systemd/system/
   systemctl enable adom-workspace-updater.timer    # writes the multi-user.target.wants symlink; works offline in chroot/docker
   rm -rf /tmp/workspace-updater
   ```
   (`systemctl enable` on a .timer works without a running systemd — it just
   creates the wants-symlink. If the chroot lacks `systemctl`, fall back to
   `ln -s ../adom-workspace-updater.timer /etc/systemd/system/timers.target.wants/`.)
4. **Smoke** (build-rootfs.sh + CI): assert
   `test -x /usr/local/bin/adom-workspace-updater`,
   `test -f /etc/systemd/system/adom-workspace-updater.timer`, and the enable
   symlink exists. Do NOT assert Codex is present — the daemon installs it at
   runtime, not at bake.

## Preconditions

- `~/gallia` exists and is freshly pulled (`cd ~/gallia && git pull --ff-only`)
- `~/project/hydrogen-desktop` exists (HD skills source; pull main for releases)
- ~8 GB free under `/tmp` (`df -h /tmp`)
- No other bake running (`pgrep -f build-rootfs.sh` — shared `/tmp/hd-golden-build` workdir)

## Procedure

**Preferred path — CI (real docker, full smoke incl. native claude verify):**

```bash
cd /home/adom/project/hd-wsl2-image && git pull --ff-only
gh release list --repo adom-inc/hd-wsl2-image     # pick next vN
gh workflow run build-golden-image -f version=vN
gh run watch $(gh run list --workflow build-golden-image --limit 1 --json databaseId -q '.[0].databaseId') --exit-status
# CI does build + smoke + release + ghcr push. Then SKIP to step 5 (verify).
# Needs the GALLIA_TOKEN repo secret (read access to gallia + hydrogen-desktop).
```

**Fallback path — local chroot build** (CI down, or iterating on the recipe):

```bash
cd /home/adom/project/hd-wsl2-image
git pull --ff-only

# 1. Next version: current releases, then increment
gh release list --repo adom-inc/hd-wsl2-image

# 2. Build (~20 min). ALWAYS in background with a log; gate on SMOKE-OK.
GOLDEN_VERSION=vN ./scripts/build-rootfs.sh > /tmp/hd-golden-build.log 2>&1 &
```

Monitor `/tmp/hd-golden-build.log` for `[build-rootfs ...]` / `[bake-hd-setup ...]`
phase lines. Known-benign noise: `E: Can not write log (Is /dev/pts mounted?)`
(apt in a mount-less chroot). Hard failures print `MISSING ...` / `LEAK ...`
from the smoke test — the build exits non-zero; do NOT release.

```bash
# 3. Verify the build said SMOKE-OK and produced artifacts
grep SMOKE-OK /tmp/hd-golden-build.log
ls -lh /tmp/hd-golden-build/adom-golden-vN.tar.gz*

# 4. Release (fix the sha256 file to a bare filename first)
cd /tmp/hd-golden-build
sed -i 's|/tmp/hd-golden-build/||' adom-golden-vN.tar.gz.sha256
gh release create vN adom-golden-vN.tar.gz adom-golden-vN.tar.gz.sha256 \
  --repo adom-inc/hd-wsl2-image --title "Golden WSL2 rootfs vN" \
  --notes "<what changed since the last bake>"

# 5. Verify the public download + hash (NEVER skip — release ≠ verified)
curl -fsSL -o /tmp/verify.tar.gz \
  "https://github.com/adom-inc/hd-wsl2-image/releases/download/vN/adom-golden-vN.tar.gz"
sha256sum /tmp/verify.tar.gz   # must equal the .sha256 asset
rm -f /tmp/verify.tar.gz
```

## 6. ALWAYS show John the latest in pup (John's standing preference)

After every successful release, show John the NEW version in pup — don't wait
to be asked.

⛔ **NEVER do this with proot/code-server in the cloud container** (see
`cloud-container-safety`: a nested code-server here has bricked the container).
Show it from a **disposable WSL2 distro on the laptop** instead, via the
`golden-image-test` skill: import the released tarball as `golden-test-vN`
(never touch `Adom-Workspace`), start code-server INSIDE that distro on the
laptop, pup to it (localhost or the WSL IP on the laptop), then
`wsl --unregister golden-test-vN` after. Confirm it's the right build with
`cat /etc/adom-golden-version` → vN (a stale pup window on an old rootfs shows
the old marker — how John caught a v8 window after v9). This is the SAME run
that validates systemd/timer/daemon, so it doubles as the visual.

If the laptop/AD is unreachable, say so and defer the visual — do NOT fall
back to proot in the container.

## Hand-off to HD

HD consumes the image via three consts in
`hydrogen-desktop/src-tauri/crates/hd-app/src/runtime/wsl.rs`:
`TARBALL_URL_PLACEHOLDER`, `TARBALL_SHA256_PLACEHOLDER`, `TARBALL_VERSION`.
After releasing, give the HD thread the new URL + sha256 + version so it
bumps the pins (existing installs migrate via `migrate_to_new_tarball`).

## Invariants (smoke-tested; never regress)

- **Public build**: nothing in the image requires GitHub auth. No
  `gallia/.git`, no gallia stale-detector hook (`check-updates.sh`) in
  `~/.claude/settings.json` — `image/public-scrub.sh` enforces this.
- **No model pins**: neither `~/.claude/settings.json` (`model`) nor
  code-server `settings.json` (`claudeCode.selectedModel`) names a model —
  Claude Code picks the default for the user.
- install.mjs success = its `Installation complete` marker, NOT exit code.
- wsl.conf: `default=adom`, `systemd=true`.
