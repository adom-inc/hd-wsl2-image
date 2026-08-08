# adom/hydrogen-bootstrap

Hydrogen Desktop's workspace layer, as an adompkg bootstrap. It's a thin
package: a dependency list + one config hook. Installing it converges a
workspace to "ready to run inside Hydrogen Desktop."

```
adompkg install adom/hydrogen-bootstrap
```

The golden WSL2 image runs exactly that line at bake time and ships the
result pre-converged. A live workspace can run the same line on demand. The
bake is an optimization of the runtime flow, not a different mechanism.

## How it layers

`adom/hydrogen-bootstrap` depends on `adom/core` and adds only what's specific to
running inside HD. Layering is not a special feature — a layer is just a
bootstrap that depends on the one below it. `core` is pulled unmodified.

```
adom/core                ← the Adom ecosystem (shared with web Hydrogen)
  └─ adom/hydrogen-bootstrap    ← THIS: HD-runtime skills + daemon + HD editor config
```

This is the public **reference design**: other orgs build their own bootstrap
the same way. A vendor publishes `<org>/bootstrap` depending on `adom/core`
(plus `adom/hydrogen-bootstrap` only if their capability needs HD's runtime), and
their users get set up by telling their AI "I use <org>." See
[../BOOTSTRAP-CONVENTION.md](../BOOTSTRAP-CONVENTION.md) for the naming +
layering convention.

## What's a dependency vs. what's in the hook

The rule: **anything that is a package is a dependency; environment config
that isn't a package is the `postinstall` hook; the OS baseline is the golden
image's Dockerfile (not this package at all).**

### Dependencies — all three resolve anonymously (verified 2026-06-19)

| Dep | Why it's here | Status |
|-----|---------------|--------|
| `adom/core` | The whole Adom ecosystem — skills hub, distributor search, KiCad/Fusion, pup, `adom-cli`, the `adom-vscode` binary, `adompkg`, etc. Replaces what gallia used to bake. | ✅ published 4.9.1, anon + sudo-free |
| `adom/adom-workspace-updater` | The in-distro updater daemon (systemd .service/.timer). | ✅ published 0.1.11, anon — **`needs_sudo: true`** |
| `adom/adom-desktop` | The Adom Desktop relay CLI. | ✅ published 1.8.147, anon |

> The `hd-*` skills are **bundled into this package** (the `skills/` dir), not a
> dependency — they're HD-specific with no independent lifecycle. The three
> ecosystem CLIs (`adom-google`, `adom-tts`, `adom-gchat`) are **inherited via
> `adom/core`** once added there (they resolve anonymously and are sudo-free) —
> HD does not carry ecosystem apps directly.

> **⚠ Installing this package requires `--allow-sudo`.** `adom/adom-workspace-updater`
> is `needs_sudo: true` (it writes systemd units), and adompkg refuses a sudo
> install script without an explicit opt-in — passwordless sudo alone is NOT
> enough. The bake (and any live install) must run:
> `ADOMPKG_ALLOW_SUDO=1 adompkg install adom/hydrogen-bootstrap`.

### postinstall.sh (deploy bundled skills + environment config)

Runs as the workspace user after all deps install (`sudo` only for the
system-owned workbench file). Mirrors the config sections of
`hd-wsl2-image/image/bake-hydrogen-setup.sh`:

0. Deploy the bundled `hd-*` skills (`skills/` dir → `~/.claude/skills/`)
1. Claude Code CLI (claude.ai installer → `~/.local/bin/claude`)
2. Claude Code extension (Open VSX) registered in code-server
3. `adom-vscode` extension `.vsix` registered in code-server (binary from the `core` dep)
4. code-server `settings.json` (dark theme, Claude Code perms, chat/agent panel off, silent ports — no model pin)
5. code-server `config.yaml` (telemetry + update-check off)
6. `workbench.html` IndexedDB seed (trusted domains `*` + activity-bar unpin)
7. tidy (`rm ~/project/.mcp.json`)

### NOT in this package (golden-image Dockerfile)

apt baseline, code-server, systemd/systemd-sysv, cron, the gh CLI,
user/group/linger/pam fixes. The "hardware" the bootstrap runs on. A live
install assumes a workspace that already has it.

### NOT in this package (per-machine, injected by HD at `wsl --import`)

The Carbon API key, `DefaultUid=1001`, the `host.docker.internal` alias.

## Open decisions / remaining work

- ✅ **Skills bundled into `skills/`** — the **31 platform-generic** `hd-*` skills.
  The other 15 are Windows-specific (in `adom/hydrogen-windows-bootstrap`); 13 mixed
  skills were split, generic core here + a `<name>-windows` companion in the
  Windows layer. Decided: bundled, not a separate `adom/hd-skills` package.
- **InstaPCB:** the generic bundle **includes `hydrogen-instapcb`** (and `hydrogen-who-am-i`'s
  InstaPCB lines). This package is published **public WITH InstaPCB included** —
  an explicit owner decision (2026-06-19) overriding the general InstaPCB embargo
  for this package, so the launch can be planned against the real thing.
- **Edit `adom/core` to add `adom-google` / `adom-tts` / `adom-gchat`** so HD
  inherits them (all three verified anon + sudo-free). Needs core's source
  (wiki-git) + a republish.
- **Skill-vs-binary completeness in core:** core deps the distributor *skills*
  (`adom/mouser`…), not the *binaries* (`adom/adom-mouser`…). Confirm whether
  the skills just drive `adom-cli` (in core) — decides whether the Dockerfile
  still bakes the distributor binaries.

## Status (2026-06-19)

**PUBLISHED + PUBLIC** at `adom/hydrogen-bootstrap@0.2.0` on wiki.adom.inc. Deps
resolve anonymously; the `adom/core` contract is **green** (anonymous +
sudo-free across the whole tree). Install requires `ADOMPKG_ALLOW_SUDO=1` (the
Windows layer's updater dep is `needs_sudo`). The golden-image bake
(`bake-via-bootstrap.sh`) installs `adom/hydrogen-windows-bootstrap`, which pulls this
+ `adom/core`. **Open blocker for the bake:** `adom/fusion-update-libraries@3.0.0`
(a transitive dep of `adom/core`) currently FAILS signature verification —
Colby must republish it before any `adompkg install adom/core` (and thus the
bake) can complete. Build the image on the laptop via AD or in CI, never in the
cloud container.
