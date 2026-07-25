---
name: hd-eda-discovery-windows
description: >
  Windows-specific EDA detection probe for the post-setup discovery pass — how to find
  no-bridge EDA tools (Altium, OrCAD, Cadence/Allegro, EAGLE, DipTrace, Eplan) by scanning
  C:\Program Files / C:\Program Files (x86) and Get-Process via a PowerShell run_script.
  Read alongside the platform-generic [[hd-eda-discovery]]. Trigger words — detect altium
  windows, scan program files, powershell eda probe, Get-Process altium, orcad install path,
  run_script eda detect.
---

# EDA discovery — Windows no-bridge probe

Platform companion to **[[hd-eda-discovery]]**. The bridge-based detection
(`kicad_list_versions`, `fusion_status`) and the entire branching/onboarding/pitch logic live
in the generic skill. This file is ONLY the Windows recipe for the tools that have **no bridge**
and must be detected by install path / running process.

## The probe

Base64-encode the PowerShell and run it through `adom-desktop run_script` (base64 avoids all the
shell-quoting pain). Use absolute paths.

```bash
adom-desktop run_script '{"interpreter":"powershell","scriptB64":"<b64 of:>"}'
#   Get-ChildItem 'C:\Program Files','C:\Program Files (x86)' -Directory -EA 0 |
#     ? { $_.Name -match 'Altium|OrCAD|Cadence|Allegro|EAGLE|DipTrace|Eplan' } | % Name
#   plus: Get-Process | ? { $_.Name -match 'Altium|OrCAD|Capture|Allegro' } | % Name
```

## Notes

- **Base64 the PowerShell** for `run_script` — no quoting survives raw.
- **Use absolute paths** (`C:\Program Files`, `C:\Program Files (x86)`).
- **Treat empty output as a timeout, NOT a negative result** — the relay can return empty on a
  slow/timed-out probe, which is not the same as "tool not installed."
- The `Get-ChildItem` scan catches installed-but-not-running tools; the `Get-Process` pass
  catches anything currently open (and tools installed somewhere unusual).

## Equivalent on other platforms (for orientation)

The generic skill covers this, repeated here only so you know what the Windows probe maps to:
- **macOS** would scan `/Applications` (and `~/Applications`) for the app bundles, plus `pgrep`.
- **Linux** would `which`/`command -v` the CLI binaries and check common install dirs, plus `pgrep`.
