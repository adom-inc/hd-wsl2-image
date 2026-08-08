# adom/hydrogen-windows-bootstrap

The **Windows (WSL2)** platform layer for Hydrogen. On Windows, Hydrogen's
workspace runs inside a WSL2 Ubuntu distro; this package adds everything
specific to that runtime on top of the platform-generic `adom/hydrogen-bootstrap`.

```
adompkg install adom/hydrogen-windows-bootstrap     # the golden WSL2 image installs this
```

## The platform-layered bootstrap stack

```
adom/core                                ← Adom ecosystem (generic; shared with Hydrogen Cloud)
  └─ adom/hydrogen-bootstrap             ← Hydrogen, platform-GENERIC
       ├─ adom/hydrogen-windows-bootstrap    ← THIS: WSL2 runtime
       ├─ adom/hydrogen-mac-bootstrap        ← (Kyle)
       └─ adom/hydrogen-ubuntu-bootstrap     ← (Barrett)
```

Each platform layer depends on `adom/hydrogen-bootstrap`, which depends on
`adom/core`. The Hydrogen Cloud bootstrap depends on `adom/core` too, so core
stays generic across cloud and desktop Hydrogen.

## What this layer adds

- **Dependencies:** `adom/hydrogen-bootstrap` (the platform-generic layer) and
  `adom/adom-shotlog` (screenshot log tooling).
- **Bundled skills:** the WSL2-runtime `hydrogen-*` skills (container,
  networking, ports, port-watcher, setup, setup-steps, topology, volume,
  workspace-lifecycle, workspace-monitoring, container-stats) plus the
  `<name>-windows` companions of the mixed skills.
- **install hook:** deploys those skills + seeds the WSL2 code-server
  `workbench.html` (trusted domains + activity-bar). Sudo-free
  (`needs_sudo: false`; the old updater daemon dependency was retired
  2026-07-16).

## The skill split (real per-skill reclassification)

All the `hydrogen-*` skills were read and classified by what's
platform-generic vs Windows-specific (not the old `shared`/`wsl2` buckets):

- **Generic skills** live in `adom/hydrogen-bootstrap`.
- **Clean Windows skills** live here, e.g. `hydrogen-browser-picker` (WebView2),
  `hydrogen-recording` (WGC/DXGI), `hydrogen-runtime-mode`, `hydrogen-networking`,
  `hydrogen-ports`, `hydrogen-workspace-lifecycle`, the golden-image/WSL2 skills.
- **Mixed skills** were split: the generic core stays in `hydrogen-bootstrap`,
  and the Windows specifics become a `<name>-windows` companion here (e.g.
  `hydrogen-api-windows` carries the `/wsl/*` endpoint tables,
  `hydrogen-notifications-windows` the WinRT/AUMID toast mechanics,
  `hydrogen-setup-windows` the WSL2 install cascade). Distinct names mean both
  layers coexist with no deploy collision.

Still a **collaborative pass** with Kyle (Mac) and Barrett (Ubuntu): anything
in `hydrogen-bootstrap` that turns out to break off-Windows moves down into
the platform layers.

## Status (2026-08-08)

**PUBLISHED + PUBLIC** on wiki.adom.inc as part of the 2026-08 naming cutover
(formerly `adom/hd-windows-bootstrap`).
