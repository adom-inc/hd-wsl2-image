---
name: hd-file-transfer
description: >
  Move files BOTH WAYS between the HD WSL2 Ubuntu workspace (the Adom-Workspace
  distro, where your code lives at /home/adom/project) and the user's Windows PC
  — including their Desktop, Downloads, and any folder. Three methods: (1) the
  auto-mounted C: drive at /mnt/c inside the distro, (2) the \\wsl$ network path
  from Windows Explorer, and (3) the adom-desktop relay (send_files / pull_file)
  which also works on the legacy Docker runtime. Use when the user asks "how do I
  get this file onto my desktop", "copy this out of the workspace", "get a file
  from my PC into the workspace", "move a file in/out", "where do my downloads
  go", or "drag a file into the container". Trigger words: copy file out, copy
  file in, move file to desktop, get file from desktop, file transfer, /mnt/c,
  wsl$, \\wsl.localhost, send_files, pull_file, export file, import file, drag
  into workspace, file to my pc, download to desktop, upload to workspace.
---

# Move files between the workspace and the Windows PC

HD's default workspace is the **WSL2 `Adom-Workspace` distro**. Your work lives
at `/home/adom/project` inside it. There are three ways to move files to/from the
user's real Windows machine. Methods 1–2 are WSL2-native (fast, no relay);
method 3 (the relay) also works on the legacy Docker runtime.

## Method 1 — `/mnt/c` (from INSIDE the distro) — simplest

Windows drives are auto-mounted in the distro: `C:\` is `/mnt/c`. So you can `cp`
straight to/from the user's Desktop or Downloads. (Find the Windows username from
`/mnt/c/Users/` if you don't know it.)

```bash
WINUSER=$(ls /mnt/c/Users | grep -viE 'public|default|all users' | head -1)

# Workspace → Desktop
cp /home/adom/project/report.pdf "/mnt/c/Users/$WINUSER/Desktop/"

# Desktop → workspace
cp "/mnt/c/Users/$WINUSER/Desktop/data.csv" /home/adom/project/

# Downloads folder works the same: /mnt/c/Users/$WINUSER/Downloads/
```

## Method 2 — `\\wsl$` (from Windows Explorer) — drag & drop

From Windows, the distro is a network share. In Explorer's address bar:

```
\\wsl$\Adom-Workspace\home\adom\project
   (newer Windows also: \\wsl.localhost\Adom-Workspace\home\adom\project)
```

The user can **drag files in/out** of that folder to/from their Desktop. Tell
them this path when they want to grab their code or drop a file in by hand.

## Method 3 — the adom-desktop relay (works on ANY runtime)

HD embeds Adom Desktop, which bridges the workspace to the real OS. Use this when
you want the AI to push/pull files programmatically (and it's the ONLY method on
the legacy Docker runtime, which has no `/mnt/c`). See **hd-adom-desktop**.

```bash
# Workspace → PC (lands in the user's Downloads by default; large files OK)
adom-desktop send_files '{"filePaths":["/home/adom/project/out.zip"],"saveTo":"C:\\Users\\john\\Desktop"}'

# PC → workspace
adom-desktop pull_file '{"filePaths":["C:\\Users\\john\\Desktop\\photo.png"],"saveTo":"/home/adom/project"}'
```

Notes:
- Confirm the bridge first: `adom-desktop ping` → `pong`. If not connected, the
  user must have HD running/foregrounded.
- Files whose basename starts with `_` are silently dropped by the relay — use
  plain names.

## Which method to use

| Situation | Use |
|---|---|
| You're scripting inside the workspace (WSL2) | **Method 1** (`/mnt/c`) — fastest |
| User wants to drag files by hand | **Method 2** (`\\wsl$` path) |
| Programmatic, or runtime is Docker, or you need a Save-As target dir | **Method 3** (relay) |

## Where things persist
`/home/adom/project` survives a workspace restart; it is wiped by a **virgin
reset** (`wsl --unregister Adom-Workspace`). Copy anything important to the PC
(any method above) before a virgin reset. See **hd-volume** for the full
persistent-vs-ephemeral map.

## Related
- **hd-volume** — what persists, where files live, backing up before virgin reset
- **hd-adom-desktop** — the relay (send_files / pull_file) and OS reach
- **hd-workspace-lifecycle** — distro import/export/unregister
