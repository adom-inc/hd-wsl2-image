# hd-wsl2-image — golden WSL2 rootfs for Hydrogen

Builds the **golden image** that Hydrogen imports via
`wsl --import Adom-Workspace <dir> adom-golden-<ver>.tar.gz`.

Successor to `hydrogen-desktop/wsl-thin` (the ~30 MB bare-Ubuntu tarball
whose 18-step setup cascade installed everything on the user's machine).
The golden image pre-runs the cascade at build time instead — this is a
**public** image: nothing in it requires GitHub authentication, and
updates ship as new image versions (monthly bake), not git pulls.

| Baked at build (cascade step) | Left to runtime |
|---|---|
| Ubuntu 24.04 apt baseline, cloud-image parity (build-essential, cmake, node, python3, gh, …) | `wsl --import` + code-server start (step 1–2) |
| code-server (pinned) + **dark-mode settings.json + trusted-domains patch** (step 7) | layout hides via :8821 (browser-state half of step 7) |
| **gallia** snapshot at `~/gallia` (no .git) + full `install.mjs` deploy: skills, hooks, permissions (step 4) | `set-env-vars` — live proxy port (step 5) |
| **claude CLI** at `~/.local/bin/claude` + PATH (step 15) | `inject-api-key` — Adom session token (step 6) |
| **Claude Code extension** from Open VSX (step 16) | relay start + tests (steps 9, 11–14) |
| **adom-vscode binary + extension** registered with code-server (step 3) | `claude-auth` — user OAuth (step 17) |
| **HD self-awareness skills** shared/ + wsl2/ (step 8) | `welcome` (step 18) |
| **adom-bridge-cli CLI** latest published (step 10) | `host.docker.internal` alias (per boot) |
| Adom CLIs from the public wiki: adom-cli, adom-wiki, adom-vscode, adom-mouser, adom-digikey, adom-jlcpcb, adom-parts-search, adom-gchat | per-user state: Carbon API key, wiki token |
| `adom` user 1001 + sudoers + `/etc/wsl.conf` (`default=adom`, systemd on) | |

**Public-build invariants** (smoke-tested, see `image/public-scrub.sh`):
no `gallia/.git`, no gallia stale-detector update hook, no GitHub-auth
dependency anywhere, and **no model pins** — Claude Code picks the
default model itself (`~/.claude/settings.json` has no `model` key;
code-server settings have no `claudeCode.selectedModel`).

## Build & release

**Weekly, one command, from the cloud container against the laptop** (WSL2-native through
adom-bridge; the chroot and docker paths are retired):

```bash
bash scripts/bake-weekly.sh v29-full            # --target AdomLapper is the default
```

It stages `image/` to `C:\tmp\ctx`, imports a fresh throwaway `golden-build` distro from
`C:\tmp\ubuntu-base.tar.gz`, runs `image/bake-in-distro.sh` in the bridge's HELD session
(a detached bake dies when the distro restarts), requires `SMOKE-OK`, exports, gzips and hashes
in the workspace, releases both assets with `gh` on the laptop, verifies the public download,
and prints the pin. Then in hydrogen-desktop: `bash scripts/pin-golden.sh v29-full <sha> <bytes>`.

**A weekly image never forces an upgrade.** It is the previous image with the current
`adom-wiki pkg update` applied, which every running workspace already has; Hydrogen treats any
install on v27 or later as current (`NO_FORCED_MIGRATION_FROM`), so the pin only changes what a
fresh import downloads. Release notes per version live in `releases/`.

When a smoke gate fails, it is usually the packages that drifted (v28: a retired skill name, a
permissions marker the composer no longer writes, Satoshi font files a package started
shipping). Fix the gate or the package, never skip the gate.
In CI (once token scopes allow): `.github-pending/workflows/build.yml`
runs the same recipe via `image/Dockerfile` + docker, publishes the
release asset AND a single-layer image at `ghcr.io/adom-inc/hd-wsl2-image`.

## Consuming from HD

Pin in `hd-app/src/runtime/wsl.rs`:

```rust
pub const TARBALL_URL_PLACEHOLDER: &str =
    "https://github.com/adom-inc/hd-wsl2-image/releases/download/<ver>/adom-golden-<ver>.tar.gz";
pub const TARBALL_SHA256_PLACEHOLDER: &str = "<from the .sha256 asset>";
pub const TARBALL_VERSION: &str = "<ver>";
```

`image/Dockerfile` is the canonical recipe; `scripts/build-rootfs.sh` is
its docker-less translation. **Keep them in lockstep.**
