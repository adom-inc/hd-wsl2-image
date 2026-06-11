# Handoff: golden WSL2 image v5 — the setup cascade is now pre-baked

Paste this into the main Hydrogen Desktop thread.

---

Golden image **v5** pre-runs HD's WSL2 setup cascade at image-build time.
Built from `adom-inc/hd-wsl2-image` (public repo), hosted as a GitHub
Release asset:

- **URL:** https://github.com/adom-inc/hd-wsl2-image/releases/download/v5/adom-golden-v5.tar.gz
- **SHA256:** `1459da27f5d5587e217ced5ca4808bb365540a24519390ddc4c48732e40914bf`
- **Size:** 552 MB
- **Version:** `v5` (for `TARBALL_VERSION`)

Pin all three in `hd-app/src/runtime/wsl.rs` (`TARBALL_URL_PLACEHOLDER`,
`TARBALL_SHA256_PLACEHOLDER`, `TARBALL_VERSION`). Existing installs
migrate via the existing `migrate_to_new_tarball` path.

## Cascade disposition (vs the CURRENT 21 StepDefs in setup_steps_wsl.rs)

(Step ids, not numbers — the public hd-setup-steps skill still says "18
steps" and is stale. The distro import itself lives in
`WslDistroRuntime::setup_and_start`, before the cascade: it keeps
download+sha+`wsl --import`+start, loses user-creation and Phase A, and
**the distro now boots as `adom`, not root — audit `wsl -d` call sites**.)

**Fully baked → REMOVE these 7 steps:**

| Step id | Baked as |
|---------|----------|
| install-gallia | `~/gallia` snapshot (latest main, NO .git) + npm install + full install.mjs deploy (skills/hooks/permissions/settings), gated on its "Installation complete!" marker |
| install-adom-cli | adom-cli at `/usr/local/bin` (wiki static at bake; install.mjs refreshes it too) |
| install-hd-skills | 34 skills, shared/ + wsl2/ buckets, flat at `~/.claude/skills/hd-*/` |
| verify-adom-desktop | adom-desktop CLI 1.8.125 at `/usr/local/bin` (latest version.json at bake) |
| install-claude-cli | claude 2.1.173, official layout (`~/.local/share/claude/versions/` + `~/.local/bin/claude` symlink), PATH in .bashrc, proot-verified at build |
| install-claude-ext | anthropic.claude-code (latest Open VSX at bake) registered in code-server; `extensions.autoUpdate: true` keeps it current |
| *(plus the bakeable halves below)* | |

**Partially baked → SLIM these 2 steps:**

| Step id | Baked | Keep at runtime |
|---------|-------|-----------------|
| install-adom-vscode | binary + .vsix registered (in `--list-extensions`) | iframe reload + `:8821/health` poll (activation proof — extensions only activate on first webview load) |
| configure-vscode | settings.json (exact step payload: dark mode, Claude perms, Copilot off, silent ports, **no model pin**) + workbench.html trusted-domains patch | layout slivers only: close sidebars/panel/welcome on first show. Activity-bar trim is NOW BAKED (workbench.html seeds pinnedViewlets2 once per profile) — keep the welcome re-apply as backstop, drop the interactive hide |

**Unchanged (machine/user/runtime-specific), 12 steps:** wait-codeserver,
set-env-vars, inject-api-key, ensure-adom-desktop, start-relay,
test-direct-connect, test-relay, test-adom-cli, claude-auth, ensure-sse,
verify-workspace, welcome, open-welcome. Plus per-boot
`init-host-internal.sh`.

## Public-build guarantees (smoke-tested every bake)

- **No GitHub auth anywhere**: no `gallia/.git`, gallia's 30-min
  stale-detector hook (`check-updates.sh`) removed from
  `~/.claude/settings.json`. Updates ship as new image versions
  (monthly bake — see `skills/golden-image-bake/SKILL.md`).
- **No model pins**: gallia itself no longer writes `settings.model`
  (gallia commit `f9acf2c` — Claude Code picks the default model, and
  pre-existing gallia-written pins incl. `opus[1m]` are deleted on next
  install.mjs run); code-server settings carry no
  `claudeCode.selectedModel`.
- No shared telemetry ID: `~/.claude.json` / statsig state generated
  during build verification is scrubbed.

## wsl.rs cleanups this enables

1. Consts → v5 values above; download message "~30 MB" → "~550 MB".
2. `run_bootstrap_synchronously`: nothing left to install — drop from the
   hot path (in-image bootstrap.sh is a non-fatal updater, always exit 0).
3. The networking/DNS gate before the first apt call is dead code.
4. `start_code_server`'s wait-for-binary loop collapses (always present).

## Other facts

- v0's bootstrap Phase B (wiki install.mjs fetch) was always a 404 —
  silently swallowed by `|| true`. v0 first-runs never had CLIs/skills.
- gallia content was already publicly distributed
  (`static/apps/gallia-bundle/gallia-bundle.tar.gz` on the wiki), so the
  baked snapshot adds no new exposure.
- Rebuild procedure: `skills/golden-image-bake/SKILL.md` (monthly cadence).
- CI is LIVE: `gh workflow run build-golden-image -f version=vN` builds,
  smokes, releases, AND pushes ghcr.io/adom-inc/hd-wsl2-image (publicly
  pullable, single layer = the rootfs). v5 is the first CI-built release.
