# hd-wsl2-image — golden WSL2 rootfs for Hydrogen Desktop

Builds the **golden image** that Hydrogen Desktop imports via
`wsl --import Adom-Workspace <dir> adom-golden-<ver>.tar.gz`.

Successor to `hydrogen-desktop/wsl-thin` (the ~30 MB bare-Ubuntu tarball
whose bootstrap apt-installed everything on the user's machine). The golden
image bakes all of that at build time instead:

| Baked at build | Left to first run / per boot |
|---|---|
| Ubuntu 24.04 apt baseline (cloud-image parity: build-essential, cmake, node, python3, gh, …) | gallia skills (private repo, changes daily) |
| code-server (pinned, from GitHub) | per-user state: Carbon API key, wiki token, agents |
| `adom` user 1001 + sudoers + `/etc/wsl.conf` (`default=adom`, systemd on) | `host.docker.internal` alias (`/etc/init-host-internal.sh`, per boot) |
| Adom CLIs from the public wiki: adom-cli, adom-wiki, adom-vscode, adom-mouser, adom-digikey, adom-jlcpcb, adom-parts-search, adom-gchat (+ their skill payloads) | CLI updates (bootstrap.sh is now a best-effort updater) |

## Build & release

Runs entirely in GitHub Actions (this container has no docker):

```bash
gh workflow run build-golden-image -f version=v1
```

Outputs:
- **Release asset** `adom-golden-v1.tar.gz` (+ `.sha256`) — what HD downloads.
- **ghcr.io** `ghcr.io/adom-inc/hd-wsl2-image:v1` — single-layer image
  (`docker import` of the same rootfs), so the layer blob is the rootfs.

## Consuming from HD

Pin in `hd-app/src/runtime/wsl.rs`:

```rust
pub const TARBALL_URL_PLACEHOLDER: &str =
    "https://github.com/adom-inc/hd-wsl2-image/releases/download/v1/adom-golden-v1.tar.gz";
pub const TARBALL_SHA256_PLACEHOLDER: &str = "<from the .sha256 asset>";
pub const TARBALL_VERSION: &str = "v1";
```

With the golden image, `run_bootstrap_synchronously` no longer performs any
installs — `/var/lib/adom-bootstrap/phase-a-done` is baked, and bootstrap.sh
is a non-fatal updater that exits 0 in all cases.
