---
name: hd-golden-image
description: >
  Your Hydrogen Desktop workspace is a PRE-BAKED golden WSL2 image, not a
  machine that installed itself step-by-step. gallia, the 8 Adom CLIs, the
  `claude` CLI + Claude Code VS Code extension, code-server, the VS Code
  settings / trusted-domains / activity-bar config, AND all the hd-* self-
  awareness skills are BAKED at image-build time — none of them were installed
  by a setup step. READ THIS when a user asks "why is X already here", "how do
  I update gallia", "re-run install-hd-skills / install-gallia / install-claude",
  or "where did these skills/CLIs come from": the answer is the image, and
  updates come from a tarball-version bump, NOT a setup step. Trigger words —
  golden image, pre-baked, baked image, adom-golden, adom-golden.tar.gz, hd-wsl2-
  image, wsl --import, tarball version, adom-tarball-version, migrate tarball,
  update gallia, reinstall gallia, install-hd-skills, install-gallia, install-
  claude-cli, install-claude-ext, verify-adom-desktop, why is gallia here, where
  did the CLIs come from, how do I update the workspace, re-run setup, lightweight
  image, install on demand, command not found, ffmpeg not installed, install a tool,
  apt-get install, missing tool, is ffmpeg installed, install imagemagick/pandoc.
---

# HD Workspace = a pre-baked golden WSL2 image

Your workspace did **not** build itself by installing things one step at a time.
It was imported, fully-formed, from a **golden WSL2 image** that already contains
everything. Understanding this answers a whole class of "why is X here / how do I
update X" questions correctly.

## What's baked in (NOT installed at first-run)

The golden rootfs ships, pre-installed and smoke-gated, with:

- **gallia** (deployed via its `install.mjs` snapshot)
- the **8 Adom CLIs** (`adom-cli`, `adom-desktop`, etc. — at `/usr/local/bin`)
- the **`claude` CLI** + the **Claude Code VS Code extension** (the extension
  auto-updates via VS Code's `extensions.autoUpdate`)
- **code-server** + node, plus a baked **systemd** unit that owns code-server
  across distro boots and HD restarts
- VS Code **settings.json** (dark theme, Claude permissions), the
  **trusted-domains** list, and the **activity-bar trim** (all patched into
  `workbench.html` at bake time)
- all **hd-\* self-awareness skills** (the `shared/` + `wsl2/` buckets, flattened
  into `~/.claude/skills/<name>/`)

Because all of this is baked, the OLD setup steps that used to install it were
**removed**: `install-gallia`, `install-adom-cli`, `install-hd-skills`,
`install-claude-cli`, `install-claude-ext`, and `verify-adom-desktop` are gone.
You can see the removal comments in `setup_steps_wsl.rs` (around lines 421-450),
e.g. *"install-gallia + install-adom-cli REMOVED — both baked into the golden
image"* and *"install-hd-skills REMOVED — the hd-\* skills are baked"*. The
`install-adom-vscode` step still exists but **installs nothing** — it only proves
the baked extension *activated* (the `:8821` editor-control API answers).

## Lightweight by design — install other tools on demand

The golden image is deliberately **minimal**: it bakes the **Adom essentials** above
and little else. General-purpose tools are **not** pre-installed — **ffmpeg/ffprobe,
imagemagick, pandoc, jq, and friends are absent on purpose**, to keep the image small
and fast to download and migrate.

That is **not a limitation.** When a task needs a tool that isn't here, **install it on
demand and keep going.** The workspace has **passwordless sudo** + apt:

```bash
sudo apt-get update -qq && sudo apt-get install -y ffmpeg   # or imagemagick, pandoc, jq, …
```

So the rule when you hit **"command not found"**: **install it and proceed** — never
tell the user the workspace "can't do that." (This mirrors how `adompkg` helps install
an app's dependencies for Adom Wiki apps: lightweight base, add what the user needs,
when they need it.) Don't push to bake every tool into the image — the image stays
lean and the AI provisions per task.

## Where the image comes from

The image is built and released from the **public** `adom-inc/hd-wsl2-image`
repo. HD downloads the release asset `adom-golden.tar.gz` **anonymously** (HD
users have no GitHub identity), verifies its SHA-256, then `wsl --import`s it as
the `Adom-Workspace` distro. Evidence in `runtime/wsl.rs`:

- `TARBALL_URL_PLACEHOLDER` / `TARBALL_SHA256_PLACEHOLDER` (~lines 142-145) — the
  GitHub-release download URL + expected hash
- `download_tarball()` (~line 1893) — streams the ~550 MB asset to a cached
  `adom-golden.tar.gz` (under `%LocalAppData%\Adom\HydrogenDesktop\cache`),
  reusing the cache if present so a re-setup doesn't re-download
- `fresh_import()` (~line 307) — `wsl --import Adom-Workspace … --version 2`

So when a user asks **"why is gallia/the CLIs/these skills already here?"** the
answer is: they came pre-installed in the golden image — nothing installed them
on your machine.

## How updates actually happen — a tarball-version bump, NOT a setup step

The installed image carries a version label at **`/etc/adom-tarball-version`**
(const `TARBALL_VERSION_FILE`), written on import. HD's expected version is the
`TARBALL_VERSION` const in `runtime/wsl.rs` (~line 152). On each launch HD
compares them:

- `read_installed_version()` reads `/etc/adom-tarball-version` from inside the
  distro
- if it differs from `TARBALL_VERSION`, HD runs **`migrate_to_new_tarball()`**
  (~line 2076): terminate → full `wsl --export` rollback backup → back up
  `/home/adom` → `wsl --unregister` → `fresh_import()` the new image → restore
  `/home/adom` → `write_installed_version()`. Your files in `/home/adom` survive;
  the system layer is swapped wholesale. On any failure it rolls back from the
  export so you're never left with no distro.

The practical upshot for answering users:

| User asks | Correct answer |
|---|---|
| "How do I update gallia / the CLIs / the skills?" | You don't run an installer. A new golden image (`adom-inc/hd-wsl2-image`) is released, HD's `TARBALL_VERSION` is bumped, and on next launch HD migrates the distro — gallia/CLIs/skills come along baked. |
| "Can I re-run `install-hd-skills` / `install-gallia`?" | No — those setup steps were **removed**. They don't exist anymore because the artifacts are baked. To refresh them, take a new image (tarball-version bump), not a setup step. |
| "Why is `claude` / the extension already signed-in-ready?" | The CLI + extension are baked; the only thing the cascade does is the one human **sign-in** (the `claude-auth` step). |
| "How do I reset to a clean image?" | `wsl --unregister Adom-Workspace` (or HD's Virgin Reset) → next setup re-imports the golden tarball (the cache can be cleared so it re-downloads). |

## The cascade now just CONFIGURES the baked image

Because installation moved into the image, the WSL setup cascade shrank to **16
steps** that *configure* the already-complete workspace (ensure/start code-server,
activate the baked extension, set env vars, inject the API key, configure VS
Code, the relay/connectivity gates, Claude sign-in, and Welcome). See
[hd-setup-steps](../../wsl2/hd-setup-steps/SKILL.md) for the per-step detail.

## Related skills
- [hd-runtime-mode](../hd-runtime-mode/SKILL.md) — WSL2 (this golden-image path) vs the legacy Docker runtime
- [hd-workspace-lifecycle](../../wsl2/hd-workspace-lifecycle/SKILL.md) — start/stop/reset/migrate the imported distro
- [hd-setup-steps](../../wsl2/hd-setup-steps/SKILL.md) — the 16 configure-the-image steps (what's left after baking)
