# adom/hydrogen-windows-bootstrap

The **Windows (WSL2)** platform layer for Hydrogen Desktop. On Windows, HD's
workspace runs inside a WSL2 Ubuntu distro; this package adds everything
specific to that runtime on top of the platform-generic `adom/hydrogen-bootstrap`.

```
adompkg install adom/hydrogen-windows-bootstrap     # the golden WSL2 image installs this
```

## The platform-layered bootstrap stack

```
adom/core                         ← Adom ecosystem (generic; shared with web Hydrogen)
  └─ adom/hydrogen-bootstrap            ← Hydrogen Desktop, platform-GENERIC
       ├─ adom/hydrogen-windows-bootstrap   ← THIS — WSL2 runtime
       ├─ adom/hd-mac-bootstrap       ← (Kyle)
       └─ adom/hd-ubuntu-bootstrap    ← (Barrett)
```

Each platform layer depends on `adom/hydrogen-bootstrap`, which depends on
`adom/core`. Colby's `hydrogen-web` bootstrap depends on `adom/core` too, so
core stays generic across web + desktop Hydrogen.

## What this layer adds

- **Dependencies:** `adom/hydrogen-bootstrap` (generic HD) + `~~adom/adom-workspace-updater~~ (RETIRED 2026-07-16, dep removed in 0.2.3)`
  (the in-distro systemd updater daemon — WSL2/systemd-specific).
- **Bundled skills:** the WSL2-runtime `hd-*` skills (container, networking,
  ports, port-watcher, setup, setup-steps, topology, volume, workspace-lifecycle,
  workspace-monitoring, container-stats).
- **postinstall:** deploys those skills + seeds the WSL2 code-server
  `workbench.html` (trusted domains + activity-bar). Install requires
  `ADOMPKG_ALLOW_SUDO=1` (the updater dep is `needs_sudo`).

## The skill split (v0.2.0 — real per-skill reclassification)

All 46 `hd-*` skills were read and classified by what's platform-generic vs
Windows-specific (not the old `shared`/`wsl2` buckets):

- **Generic skills** (31) live in `adom/hydrogen-bootstrap`.
- **Clean Windows skills** (15) live here — e.g. `hd-browser-picker` (WebView2),
  `hd-recording` (WGC/DXGI), `hd-runtime-mode`, `hydrogen-networking`, `hydrogen-ports`,
  `hydrogen-workspace-lifecycle`, the golden-image/WSL2 skills.
- **Mixed skills** were split: the generic core stays in `hd-bootstrap`, and the
  Windows specifics become a `<name>-windows` companion here (13 of them — e.g.
  `hydrogen-api-windows` carries the `/wsl/*` endpoint tables, `hydrogen-notifications-windows`
  the WinRT/AUMID toast mechanics, `hydrogen-setup-windows` the WSL2 install cascade).
  Distinct names mean both layers coexist with no deploy collision.

Still a **collaborative pass** with Kyle (Mac) and Barrett (Ubuntu): anything in
`hd-bootstrap` that turns out to break off-Windows moves down into the platform
layers.
