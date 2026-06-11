# Handoff: golden WSL2 image replaces the thin-tarball setup flow

Paste this into the main Hydrogen Desktop thread.

---

A golden WSL2 rootfs image now exists that eliminates most of HD's WSL
setup steps. Built from `adom-inc/hd-wsl2-image` (public repo), hosted as
a GitHub Release asset:

- **URL:** https://github.com/adom-inc/hd-wsl2-image/releases/download/v1/adom-golden-v1.tar.gz
- **SHA256:** `aa24401588f43e2cbaee1d0faa4a83fc4291557658963ca14dbef4f156972131`
- **Size:** 378 MB (396,023,562 bytes) (vs 30 MB thin tarball — but the thin flow downloaded
  ~200 MB at first run anyway, from Ubuntu mirrors + GitHub + the wiki)
- **Version:** `v1` (for `TARBALL_VERSION`)

## What's baked in (no longer done at install time)

- Full apt baseline at **cloud-image parity** (`docker/Dockerfile` package
  list: build-essential, cmake, node, npm, python3, gh, etc.) — Ubuntu
  24.04.4, glibc 2.39
- **code-server 4.112.0** installed — starts seconds after import
- **adom user (1001:1001)** + passwordless sudo + `/home/adom/project`
- `/etc/wsl.conf` with `default=adom` and `systemd=true` ⚠️ v0 defaulted
  to **root**; any `wsl -d Adom-Workspace` invocation that assumed root
  now runs as `adom` (with sudo available) — audit those call sites
- Adom CLIs in `/usr/local/bin`: adom-cli, adom-wiki, adom-vscode,
  adom-mouser, adom-digikey, adom-jlcpcb, adom-parts-search, adom-gchat
  (+ their `install` skill payloads where they succeeded at bake time)
- `/var/lib/adom-bootstrap/phase-a-done` sentinel pre-written
- `/etc/adom-golden-version` = `v1`
- `/opt/adom/bootstrap.sh` replaced with a **non-fatal updater** (always
  exits 0; fetches install.mjs if it's ever published, otherwise logs a
  skip)

## What this lets you delete/simplify in `hd-app/src/runtime/wsl.rs`

1. Update the three consts: `TARBALL_URL_PLACEHOLDER`,
   `TARBALL_SHA256_PLACEHOLDER`, `TARBALL_VERSION = "v1"`. Existing v0
   installs migrate via the existing `migrate_to_new_tarball` path.
2. `run_bootstrap_synchronously`: no longer installs anything. The 6-min
   timeout can drop to ~30 s, or the call can be skipped entirely on the
   hot path (fire-and-forget the updater).
3. The **networking/DNS gate before the first apt call** is dead code —
   there is no apt at first run anymore.
4. Progress UI: "downloading adom-thin.tar.gz (~30 MB)" → golden image
   size; remove the apt/code-server install progress phases.
5. `start_code_server`'s "wait for code-server to appear on PATH" loop
   collapses — it's always present.
6. Keep per-boot: `init-host-internal.sh` (host.docker.internal) and
   `wsl --import` recovery — unchanged.

## Facts discovered while building this (independent of the golden image)

- **bootstrap.sh Phase B has been silently dead**: the hardcoded
  `https://wiki-ufypy5dpx93o.adom.cloud/static/install.mjs` returns 404
  (install.mjs only exists inside the private gallia repo; it was never
  published to the wiki). The `|| true` in `run_bootstrap_synchronously`'s
  bash invocation swallowed this. So v0 first-runs never installed gallia
  skills or Adom CLIs — the golden image fixes the CLI half outright;
  gallia-on-first-run remains an open design question (it's a private
  repo, so it can't be baked into a publicly hosted image).
- The shipped v0 tarball (30 MB) was the **bare** Ubuntu export — the
  wsl-thin Dockerfile's code-server bake never shipped.
- v0 hosting is John's dev container proxy URL — replaced by the GitHub
  Release URL above.

## Rebuilding the image

- Canonical recipe: `image/Dockerfile` in adom-inc/hd-wsl2-image
- Built without docker via `scripts/build-rootfs.sh` (chroot-based, runs
  in an Adom cloud container)
- A GitHub Actions workflow (docker build + ghcr.io push + release) is
  sitting in `.github-pending/` — it lands once the gh token gains
  `workflow` + `write:packages` scopes
  (`gh auth refresh -h github.com -s workflow,write:packages,read:org,repo,gist`).
  Until then, ghcr.io hosting is pending; the release asset is canonical.
