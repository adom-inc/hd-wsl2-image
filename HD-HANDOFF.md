# Handoff: golden WSL2 image v2 — the setup cascade is now pre-baked

Paste this into the main Hydrogen Desktop thread.

---

Golden image **v2** pre-runs HD's WSL2 setup cascade at image-build time.
Built from `adom-inc/hd-wsl2-image` (public repo), hosted as a GitHub
Release asset:

- **URL:** https://github.com/adom-inc/hd-wsl2-image/releases/download/v2/adom-golden-v2.tar.gz
- **SHA256:** `7e13c68e0baca87691cf0a150741937b2f2042dd36455842e350274b041c193d`
- **Size:** 552 MB
- **Version:** `v2` (for `TARBALL_VERSION`)

Pin all three in `hd-app/src/runtime/wsl.rs` (`TARBALL_URL_PLACEHOLDER`,
`TARBALL_SHA256_PLACEHOLDER`, `TARBALL_VERSION`). Existing installs
migrate via the existing `migrate_to_new_tarball` path.

## Cascade disposition (vs the 18 steps in setup_steps_wsl.rs)

**Fully baked → REMOVE these steps:**

| # | Step | Baked as |
|---|------|----------|
| 4 | install-gallia | `~/gallia` snapshot (latest main, NO .git) + npm install + full install.mjs deploy (skills/hooks/permissions/settings), gated on its "Installation complete!" marker |
| 8 | install-hd-skills | 34 skills, shared/ + wsl2/ buckets, flat at `~/.claude/skills/hd-*/` |
| 10 | verify-adom-desktop | adom-desktop CLI 1.8.125 at `/usr/local/bin` (latest version.json at bake) |
| 15 | install-claude-cli | claude 2.1.173, official layout (`~/.local/share/claude/versions/` + `~/.local/bin/claude` symlink), PATH in .bashrc, proot-verified at build |
| 16 | install-claude-ext | anthropic.claude-code (latest Open VSX at bake) registered in code-server; `extensions.autoUpdate: true` keeps it current |

**Partially baked → SLIM these steps:**

| # | Step | Baked | Keep at runtime |
|---|------|-------|-----------------|
| 1 | ensure-workspace | adom user 1001 + sudoers + wsl.conf (**`default=adom` — v0 booted as root; audit `wsl -d` call sites**), code-server installed | WSL2 check, download+sha, `wsl --import`, start code-server |
| 3 | install-adom-vscode | binary + .vsix registered (in `--list-extensions`) | iframe reload + `:8821/health` poll (activation proof — extensions only activate on first webview load) |
| 7 | configure-vscode | settings.json (exact step payload: dark mode, Claude perms, Copilot off, silent ports, **no model pin**) + workbench.html trusted-domains patch | layout half only (sidebars/panel/welcome/activity-bar — webview IndexedDB state, unbakeable) |

**Unchanged (machine/user-specific):** 2 wait-codeserver, 5 set-env-vars,
6 inject-api-key, 9 ensure-adom-desktop, 11–13 relay, 14 test-adom-cli,
17 claude-auth, 18 welcome. Plus per-boot `init-host-internal.sh`.

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

1. Consts → v2 values above; download message "~30 MB" → "~550 MB".
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
- CI workflow (docker build + ghcr.io) is staged in `.github-pending/`,
  blocked on gh token scopes (`workflow`, `write:packages`).
