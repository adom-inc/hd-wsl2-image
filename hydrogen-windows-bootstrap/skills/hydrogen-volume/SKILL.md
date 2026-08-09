---
name: hydrogen-volume
description: How Hydrogen's WSL2 workspace storage is laid out — what's persistent, what's ephemeral, where your work lives, what survives a workspace restart vs a virgin reset, and how to access your workspace files from your Windows host. Use when the user asks "where are my files", "did I lose my work", "how do I copy a file out of the workspace", or "what happens to my code if I virgin reset". Trigger words — wsl filesystem, hd volume, where are my files, workspace files, persistent storage, lost my work, /home/adom/project, distro filesystem, wsl export, copy file out of workspace, where is my code, workspace backup, wsl unregister.
---

# Hydrogen Workspace Storage — what persists, what doesn't

WSL2-runtime version (default). Legacy Docker container runtime (`HD_RUNTIME=docker`) is in the docker/ bucket.

Your work lives in the `Adom-Workspace` WSL2 distro at `/home/adom/project`. There is **no Docker named volume** — `/home/adom/project` sits directly in the distro's own ext4 filesystem. ALL your work belongs under that path. It persists for as long as the distro stays registered with WSL.

## The filesystem

| Property | Value |
|----------|-------|
| Distro name | `Adom-Workspace` (fixed) |
| Your work path | `/home/adom/project` (plain directory in the distro's ext4 fs) |
| Backing store | The distro's virtual disk (`ext4.vhdx`) inside the WSL2 LxssManager store on Windows |
| On-disk location (Windows) | Under `%LOCALAPPDATA%\...\Adom-Workspace\` — but you don't poke at the vhdx directly; use `\\wsl$\Adom-Workspace\...` (see below) |
| Persistence | Survives workspace restart, Hydrogen restart, and Windows reboot. Persists as long as the distro is **registered** with WSL. |

There is **no named volume to delete separately** — the project files and the OS image are one and the same ext4 filesystem. The only thing that wipes `/home/adom/project` is unregistering the distro.

## What lives WHERE

| Path inside the distro | Persists across a tarball re-import? | Notes |
|------------------------|---------------------------------------|-------|
| `/home/adom/project/` | **Yes** — Hydrogen exports `/home/adom` before re-importing the golden image on a version bump, then restores it | This is your code. Put everything important here. |
| `~/.local/share/code-server/extensions/` | **Yes** within the distro — BAKED into the golden image, restored on tarball re-import | Not a setup step; baked at image-build time |
| `~/.local/share/code-server/User/settings.json` | **Yes** within the distro — BAKED into the golden image | Not a setup step; baked at image-build time |
| `~/.claude/` (skills, credentials) | Skills are BAKED into the golden image (restored on re-import); credentials are restored by the `claude-auth` setup step from a host-side backup | Hydrogen skills are baked FLAT into `~/.claude/skills/<name>/` |
| `/tmp/` | **No** | Ephemeral |
| `/etc/`, `/usr/`, system stuff | Lives in the same ext4 fs, but is overwritten on a tarball version bump | Treat as part of the workspace image |

**Rule of thumb:** if you want it to survive a workspace rebuild, put it under `/home/adom/project/`.

## What survives each virgin-reset choice

When you open Virgin Reset (Hydrogen setup panel), the checkbox toggles control which artifacts get deleted:

| Toggle ON means: | Result |
|------------------|--------|
| Install step state | `setup-steps-wsl.json` deleted; next setup re-runs everything. Your project files unaffected. |
| WSL distro | **`wsl --unregister Adom-Workspace`. This wipes the ENTIRE distro including `/home/adom/project/`. This is the destructive option.** No reboot needed; the wipe is immediate. |
| Workspace image | Deletes the cached `adom-golden.tar.gz`, so setup re-downloads it on next run. Your distro (and your code, if still registered) is unaffected. |
| Adom session token | Re-login required next time. Project files unaffected. |
| Claude credentials | Claude Code requires re-auth. Project files unaffected. |

**The only toggle that destroys your work is "WSL distro" (the unregister).** All others are safe for your code. (Note: the "image" reset just deletes the cached `adom-golden.tar.gz` — NOT a 390MB Docker image like the legacy runtime.)

⚠️ The reset only ever targets `Adom-Workspace`. It NEVER runs a global `wsl --shutdown` or `wsl --uninstall`, which would hit every other WSL distro on the machine.

## Accessing workspace files from Windows

Under WSL2 you **can** browse the distro's filesystem directly from Windows Explorer — a real advantage over the legacy Docker named-volume runtime. There is no `docker cp`.

### 1. Windows Explorer via the `\\wsl$` share
Open Explorer and go to:
```
\\wsl$\Adom-Workspace\home\adom\project\
```
(or the newer form `\\wsl.localhost\Adom-Workspace\home\adom\project\`).
You can drag files in and out, double-click to open in Windows apps, etc. The distro must be running (it auto-starts when you access the share).

### 2. From inside the distro, reach Windows drives at `/mnt/c/...`
```bash
# Copy a workspace file out to the Windows Downloads folder
cp /home/adom/project/myfile.txt /mnt/c/Users/john/Downloads/

# Copy a Windows file into the workspace
cp /mnt/c/Users/john/Downloads/myfile.txt /home/adom/project/
```

### 3. `adom-bridge-cli send_files` / `pull_file` (from inside the workspace, via the relay)
```bash
# Send a workspace file to your Windows desktop's Downloads folder
adom-bridge-cli send_files '{"filePaths":["/home/adom/project/myfile.txt"],"targetApp":"general","destinationFolder":"."}'

# Pull a Windows file into the workspace's /tmp
adom-bridge-cli pull_file '{"filePaths":["C:\\Users\\john\\Downloads\\myfile.txt"],"saveTo":"/tmp"}'
```

### 4. Open the workspace's `/home/adom/project/` in VS Code's File Explorer
Just use the built-in code-server tree — the project folder is what's open, so anything you create/edit there hits the distro fs directly.

## Backing up your workspace

Persistence and backup for WSL2 is `wsl --export` / `wsl --import` — NOT a Docker volume tar. Before a destructive operation (the WSL-distro virgin-reset/unregister):

```cmd
:: Export the whole distro to a tarball on your Windows host
wsl --export Adom-Workspace C:\Users\john\Downloads\adom-workspace-backup.tar

:: Restore it later (re-register the distro from the backup)
wsl --import Adom-Workspace C:\WSL\Adom-Workspace C:\Users\john\Downloads\adom-workspace-backup.tar
```

This is exactly the mechanism Hydrogen's own tarball-migration uses: on a tarball version bump it `wsl --export`s `/home/adom` first, then re-imports the new base and restores your work.

Or, for just a few files, copy them out first via `\\wsl$\Adom-Workspace\...` or `/mnt/c/...`.

## Why a distro filesystem (no named volume, no bind mount)?

Hydrogen keeps your work directly inside the `Adom-Workspace` ext4 filesystem rather than a Docker named volume or a bind mount of a Windows path. This:
- Gives native Linux ext4 I/O — much faster than crossing the Windows ↔ WSL2 filesystem boundary
- Avoids line-ending and permission issues that bind mounts of Windows paths often have
- Lets Hydrogen wipe + re-import the base image (on a tarball bump) without losing your code — it `wsl --export`s `/home/adom` first

The bonus over the legacy Docker runtime: you **can** open the files directly in Windows Explorer at `\\wsl$\Adom-Workspace\...`.

## Related skills

- `hydrogen-container` — the `Adom-Workspace` distro whose filesystem holds your work
- `hydrogen-topology` — the three-tier topology; tier 3 is this WSL2 distro
- `hydrogen-golden-image` — what's baked into `adom-golden.tar.gz` (extensions, settings, skills) vs. what setup does
