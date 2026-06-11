---
name: golden-image-test
description: Boot and browser-test the HD golden WSL2 rootfs in an Adom container (proot + code-server, no WSL needed). Use when the user says "test the golden image", "run the golden image", "serve the rootfs", "let me see the golden code-server", "verify the image config", or reports something wrong/missing in a golden image build. Every confirmed gap gets added to image/bake-hd-setup.sh AND a smoke assertion in scripts/build-rootfs.sh — that is the rule.
---

# Golden image testing — browser-level verification + feedback loop

## Boot it

```bash
cd /home/adom/project/hd-wsl2-image
./scripts/run-rootfs.sh                  # serves the last local build on :38082
./scripts/run-rootfs.sh --from v2        # or download + serve a released version
```

Then hand the user the **proxy URL** (never localhost — their browser is
outside the container): `https://<slug>.adom.cloud/proxy/38082/`
(slug from `$VSCODE_PROXY_URI`). Run it in the background; readiness =
HTTP 200/302 on `127.0.0.1:38082`.

## What this faithfully tests

Everything a user's browser sees when HD points its webview at
code-server: dark theme + settings.json prefs, installed extensions and
their auto-update behavior (live against Open VSX), the trusted-domains
patch, terminal environment — `claude` on PATH, all Adom CLIs, gallia
skills, `~/.claude/settings.json`.

## Manual checklist (in the browser)

- Theme is **Default Dark Modern**, no welcome tab, status bar hidden
- Extensions panel: `anthropic.claude-code` + `adom.adom-vscode` present;
  auto-update enabled (settings `extensions.autoUpdate: true`)
- Terminal: `claude --version`, `which claude` (→ `~/.local/bin/claude`),
  `adom-cli --version`, `adom-desktop --version`, `code-server --version`
- `ls ~/.claude/skills/` shows `adom/` + 30-odd `hd-*` skills
- `cat ~/.claude/settings.json` — has permissions/trust, NO `model` key,
  NO check-updates.sh hook
- No GitHub sign-in prompts anywhere

## What proot CANNOT test (needs real WSL on Windows)

- systemd boot, `/etc/wsl.conf` (default user, interop), `wsl --import`
- `host.docker.internal` alias (`init-host-internal.sh` runs per boot)
- adom-vscode `:8821` activation under HD's webview + the layout hides
  (sidebars/activity-bar icons — HD applies those at runtime via :8821;
  in this bare test instance the activity bar will look UNTRIMMED. That
  is expected, not a bake gap.)
- claude-auth / Adom session token flows (per-user)

## The feedback rule

When the user reports a gap ("X isn't installed", "Y setting is wrong"):

1. Fix it in `image/bake-hd-setup.sh` (or Dockerfile/build-rootfs.sh —
   keep all in lockstep).
2. **Add a smoke assertion for it in `scripts/build-rootfs.sh` AND the
   CI workflow's smoke step** — gaps become permanent regression checks;
   a future bake that loses it must fail, not release.
3. Rebake the next version (`golden-image-bake` skill) and re-test.
