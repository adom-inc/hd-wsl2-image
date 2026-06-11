---
name: golden-image-bake
description: Rebuild + release the Hydrogen Desktop golden WSL2 rootfs image (adom-inc/hd-wsl2-image). Use when the user says "bake the golden image", "rebuild the wsl2 image", "new golden image", "monthly image bake", "cut a new hd-wsl2-image version", or when gallia/CLI/extension drift makes the shipped image stale (target cadence: monthly). EMPLOYEE-ONLY — needs an Adom cloud container with the private gallia + hydrogen-desktop checkouts; never publish this skill to gallia or the public image.
---

# Golden image bake — adom-inc/hd-wsl2-image

Rebuilds the flat WSL2 rootfs that Hydrogen Desktop `wsl --import`s, with
everything pre-baked (apt baseline, code-server, gallia, claude CLI,
Claude Code + adom-vscode extensions, VS Code settings, HD skills, Adom
CLIs, adom-desktop CLI), then publishes it as a GitHub Release asset.

Repo: `/home/adom/project/hd-wsl2-image` (github.com/adom-inc/hd-wsl2-image, public).
Canonical recipe: `image/Dockerfile`; the chroot builder
`scripts/build-rootfs.sh` is its docker-less translation (this container
has no docker) — **keep them in lockstep** when editing either.

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
