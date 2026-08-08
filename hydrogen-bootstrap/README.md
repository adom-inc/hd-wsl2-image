# adom/hydrogen-bootstrap

Hydrogen's platform-generic workspace layer, as an adompkg bootstrap. It's a
thin package: a dependency list, the bundled hydrogen-* skills, and one config
hook. Installing it converges a workspace to "ready to run inside Hydrogen."

```
adompkg install adom/hydrogen-bootstrap
```

The golden image runs exactly that line at bake time and ships the result
pre-converged. A live workspace can run the same line on demand. The bake is
an optimization of the runtime flow, not a different mechanism.

## How it layers

`adom/hydrogen-bootstrap` depends on `adom/core` and adds only what's specific
to running inside Hydrogen. Layering is not a special feature: a layer is just
a bootstrap that depends on the one below it. `core` is pulled unmodified.

```
adom/core                        ← the Adom ecosystem (shared with Hydrogen Cloud)
  └─ adom/hydrogen-bootstrap     ← THIS: Hydrogen runtime skills + editor config
```

Platform layers depend on this one: `adom/hydrogen-windows-bootstrap` (WSL2)
and `adom/hydrogen-mac-bootstrap` (Lima). This is also the public **reference
design**: a vendor publishes `<org>/bootstrap` depending on `adom/core` (plus
`adom/hydrogen-bootstrap` only if their capability needs Hydrogen's runtime),
and their users get set up by telling their AI "I use <org>." See
[../BOOTSTRAP-CONVENTION.md](../BOOTSTRAP-CONVENTION.md) for the naming and
layering convention.

## What's a dependency vs. what's in the hook

The rule: **anything that is a package is a dependency; environment config
that isn't a package is the `postinstall` hook; the OS baseline is the golden
image's Dockerfile (not this package at all).**

### Dependencies (all resolve anonymously, sudo-free)

| Dep | Why it's here |
|-----|---------------|
| `adom/core` | The whole Adom ecosystem: skills hub, distributor search, KiCad/Fusion, pup, `adom-cli`, the `adom-vscode` binary, `adompkg`. |
| `adom/adom-bridge` | Adom Bridge: the `adom-bridge-cli` verb CLI and the relay that reaches the user's desktop. |

> The `hydrogen-*` skills are **bundled into this package** (the `skills/`
> dir), not a dependency; they're Hydrogen-specific with no independent
> lifecycle. Ecosystem CLIs (`adom-google`, `adom-tts`, `adom-gchat`) are
> inherited via `adom/core`.

### postinstall.sh (deploy bundled skills + environment config)

Runs as the workspace user after all deps install (`sudo` only for the
system-owned workbench file). Mirrors the config sections of
`hd-wsl2-image/image/bake-hydrogen-setup.sh`:

0. Deploy the bundled `hydrogen-*` skills (`skills/` dir → `~/.claude/skills/`)
1. Claude Code CLI (claude.ai installer → `~/.local/bin/claude`)
2. Claude Code extension (Open VSX) registered in code-server
3. `adom-vscode` extension `.vsix` registered in code-server (binary from the `core` dep)
4. code-server `settings.json` (dark theme, Claude Code perms, chat/agent panel off, silent ports, no model pin)
5. code-server `config.yaml` (telemetry + update-check off)
6. `workbench.html` IndexedDB seed (trusted domains `*` + activity-bar unpin)
7. tidy (`rm ~/project/.mcp.json`)

### NOT in this package (golden-image Dockerfile)

apt baseline, code-server, systemd/systemd-sysv, cron, the gh CLI,
user/group/linger/pam fixes. The "hardware" the bootstrap runs on. A live
install assumes a workspace that already has it.

### NOT in this package (per-machine, injected by Hydrogen at import)

The Carbon API key, `DefaultUid=1001`, the `host.docker.internal` alias.

## Notes

- The bundled set is the **platform-generic** `hydrogen-*` skills; the
  Windows-specific ones live in `adom/hydrogen-windows-bootstrap`, the mac ones
  in `adom/hydrogen-mac-bootstrap`. Mixed skills were split: generic core here,
  a platform companion in the platform layer.
- The generic bundle **includes `hydrogen-instapcb`** (and `hydrogen-who-am-i`'s
  InstaPCB lines): an explicit owner decision (2026-06-19) overriding the
  general InstaPCB embargo for this package.

## Status (2026-08-08)

**PUBLISHED + PUBLIC** on wiki.adom.inc as part of the 2026-08 naming cutover
(formerly `adom/hd-bootstrap`). Deps resolve anonymously and the whole tree is
sudo-free (`needs_sudo: false`; the retired updater daemon was the only sudo
dependency). Build the golden image on the laptop via Adom Bridge or in CI,
never in the cloud container.
