---
name: hydrogen-adom-desktop
description: >
  What Hydrogen (HD) and Adom Bridge (AD) are, what each does, and how
  they work together — so the AI in the workspace knows it has HANDS on the
  user's real operating system. HD is the workspace app the user looks at; AD is
  the bridge that reaches the user's actual machine to create files & folders,
  run shell commands, take OS screenshots, launch apps, open browsers (Pup /
  native), and drive KiCad / Fusion 360. HD bundles AD during install and runs
  it in embedded mode, but AD is a standalone product that ALSO connects Adom
  cloud containers to a user's machine. HD also has a BUILT-IN desktop bridge of
  its own that serves a subset of AD's verbs.
  READ THIS to understand your reach beyond the workspace and how to invoke it.
  Trigger words — adom desktop, AD, ad cli, what can you do on my computer, reach
  my machine, create a file on my pc, make a folder on my desktop, run a command
  on my machine, control the host, host screenshot, screenshot my screen, os
  screenshot, open a file on my computer, control my desktop, bridge to my pc,
  send file to my desktop, pull file from my desktop, hd and ad, two apps, how
  do hd and ad work together, talk to hydrogen, desktop bridge, relay,
  embedded mode, AD hidden, hd_status, hd_api, shell_execute, adom-bridge-cli ping,
  adom-bridge-cli status.
---

# Hydrogen ↔ Adom Bridge — your reach onto the user's real machine

You (the AI) run inside the **HD workspace** (a local Linux workspace on the
user's machine). That's a sandbox. **Adom Bridge (AD) is how you reach OUT of it
onto the user's actual operating system** — their real files, shell, screen, and
desktop apps. Knowing AD exists is the difference between "I can only work in
here" and "I can create that file on your Desktop, screenshot your screen, and
open it in KiCad."

> **Platform note:** HD's host layer (file/shell/screenshot/notification/window
> control) is platform-specific. Before promising a host action on a given OS,
> verify the capability with `adom-bridge-cli status` rather than assuming it.
> For Windows/WSL2-specific host behavior, see the [[hydrogen-adom-desktop-windows]]
> companion skill.

## Two apps, two jobs

| | **Hydrogen (HD)** | **Adom Bridge (AD)** |
|---|---|---|
| What it is | The user-facing workspace app (Tauri). VS Code pane + Wiki + the runtime that hosts your workspace. | A bridge app that talks to the user's real OS and local apps. |
| What the user sees | The window they work in. | Usually nothing — HD hides it (embedded mode). |
| What it does for YOU | Hosts you, your editor, your tools. | Lets you act on the host: files, folders, shell, OS screenshots, app launch, KiCad/Fusion, browsers. |
| Runs without the other? | HD spawns AD. | **Yes** — AD is a standalone product; it also connects Adom *cloud* containers to a user's machine. |

**Why two apps:** AD came first and is genuinely powerful — it's what lets any
Adom cloud container reach into a user's desktop. Rather than reinvent it, HD
**bundles AD and makes it part of HD's install**, then puts it in *embedded mode*
so the user only ever manages one app (HD). The two talk to each other
constantly. See [hd-embedded-ad](../hd-embedded-ad/SKILL.md) for the embedding
mechanics (tray ownership, lifecycle, standalone↔embedded transitions).

## HD's built-in bridge vs the embedded AD (dual-client)

Here's the subtlety that matters when you reason about "who serves this verb?":
**there are two desktop clients on the host, not one.**

1. **HD's own built-in bridge** — HD's `hd-app` crate implements a desktop bridge
   *itself* (`commands.rs::handle_command` → `screenshot.rs::handle_desktop_command`).
   It serves a **subset** of AD's verbs directly inside HD's process:
   `list_windows, screenshot_window, screenshot_screen, open_folder, open_url,
   bring_to_front, set_window_state, list_files, watch_files, install_kicad,
   install_node, list_browsers` under the `desktop` app, plus the top-level apps
   `caption, notify, shell, kicad, fusion360, browser` and the desktop verbs
   `set_project_watch, trigger_project_watch, revoke_approvals`.
2. **The standalone AD, spawned `--embedded`** by HD's supervisor
   (`ad_supervisor.rs`). AD serves the **full** verb surface — including ones
   HD's built-in bridge does NOT implement:
   `desktop_record_*`, `desktop_recorder_*`, `desktop_list_monitors`,
   `desktop_pull_glob`, `desktop_embedded_*`.

Both ends sit behind the same `adom-bridge-cli` relay, so from the CLI you don't
choose between them — the relay routes to whichever client is connected. But
"will this verb work right now?" depends on which client is up. **Don't assume a
verb exists — verify capability first:**

```bash
adom-bridge-cli status   # → .capabilities lists what the connected client(s) can do
```

If `.capabilities` is missing `record` (or `desktop_list_monitors` errors with
"unknown desktop command"), the embedded AD isn't connected — only HD's built-in
bridge is — so recording / multi-monitor / glob-pull aren't available until AD
is up. Screenshots, window control, files, shell, captions, notifications and
the KiCad/Fusion/browser bridges all work off HD's built-in bridge regardless.

## What AD/HD let you do on the user's real machine

All via the `adom-bridge-cli` CLI from inside the workspace. Rather than
re-document every verb here, this is a **capability map → the focused skill**:

| Capability | Verb(s) / surface | Where it's documented |
|---|---|---|
| **Create files/folders on the host** | `send_files` (container → desktop) | [hd-file-transfer](../hd-file-transfer/SKILL.md) |
| **Pull files from the host** | `pull_file` (desktop → container, SHA256-verified); browse + watch via `list_files` / `watch_files` | [hd-file-transfer](../hd-file-transfer/SKILL.md) |
| **Run a shell command on the host** | `shell_execute` (real host shell) | shell-trust model below |
| **Screen/window control + screenshots** | `desktop_screenshot_screen` / `desktop_screenshot_window` / `desktop_list_windows`, `desktop_set_window_state`, `desktop_bring_to_front` | [hydrogen-self-screenshot](../hydrogen-self-screenshot/SKILL.md) |
| **Record the screen / a tab** | `desktop_record_*` (whole screen), `browser_record_*` (one tab) | [hd-recording](../hd-recording/SKILL.md) — AD-served, verify `record` capability |
| **Desktop notifications** | `notify_user` (title/body/level + action buttons) | [hydrogen-notifications](../hydrogen-notifications/SKILL.md) |
| **On-screen captions** | `caption` (always-on-top click-through overlay) | [hydrogen-captions](../hydrogen-captions/SKILL.md) |
| **Open browsers** | `browser_*` (Pup) and the Browser Picker | [hydrogen-open-url](../hydrogen-open-url/SKILL.md), `pup` |
| **Drive KiCad / Fusion 360 / Pup** | `kicad_*`, `fusion_*`, `browser_*` | [hydrogen-bridges](../hydrogen-bridges/SKILL.md) |
| **Embedded mechanics (tray/lifecycle)** | `desktop_embedded_*` | [hd-embedded-ad](../hd-embedded-ad/SKILL.md) — AD-served |

For the complete verb list run `adom-bridge-cli list_commands` (or see the
`adom-bridge-cli` skill).

### Host shell-trust model

`shell_execute` runs a **real command on the user's machine** (the host's native
shell). In **embedded mode HD auto-approves** shell commands so the AI isn't
blocked on per-command approval dialogs — convenient, but it means anything you
run there really runs. Revoke the standing auto-approval at any time:

```bash
adom-bridge-cli shell_auto_approve '{"duration_secs":0}'   # turn auto-approve off now
```

When you *don't* need a free-form shell, prefer the **no-escape structured
runners** over hand-quoted `shell_execute` (AD ≥ 1.8.50):
`adom-bridge-cli run_script '{"interpreter":"bash|cmd|powershell","scriptB64":"<b64>"}'`
and `adom-bridge-cli wsl_exec '{"distro":"<workspace-distro>","user":"adom","scriptB64":"<b64>"}'`
— base64 the script so no quoting survives to be mangled. (`wsl_exec` is a
Windows/WSL2 path — see the [[hydrogen-adom-desktop-windows]] companion.)

### Auto-installing missing apps

If KiCad or Node.js is missing on the host, HD can trigger an unattended
install on platforms that support it (see the [[hydrogen-adom-desktop-windows]]
companion for the Windows winget verbs). The triggers: `install_kicad` fires
when `kicad_list_versions` returns `errorCode:"kicad_not_installed"`;
`install_node` when a `browser_*` call returns `errorCode:"node_not_found"`
(Node.js unblocks the Pup bridge).

### KiCad project auto-sync

`set_project_watch` / `trigger_project_watch` keep a KiCad project mirrored
between the workspace and the host. The watcher fires on changes to
`.kicad_sch` / `.kicad_pcb` / `.kicad_pro` files
(`project_watch.rs::KICAD_EXTENSIONS = ["kicad_sch", "kicad_pcb", "kicad_pro"]`),
so edits you make in the workspace land on the user's machine (and vice-versa)
without manual `send_files`/`pull_file` round-trips.

## Talking to HD + AD from the CLI

You reach the host through the **`adom-bridge-cli` CLI**, which relays your commands
over a WebSocket to the desktop client(s).

**Host shell + files:**
```bash
adom-bridge-cli shell_execute '{"command":"<cmd>","timeoutSeconds":60}'
adom-bridge-cli pull_file  '{"filePaths":["<host path>"],"saveTo":"/tmp"}'
adom-bridge-cli send_files '{"filePaths":["/tmp/x"],"saveTo":"<host dir>"}'
adom-bridge-cli desktop_list_windows
```

**Hydrogen control (the HD app itself):**
```bash
adom-bridge-cli hd_status            # is HD running + composed runtime state
adom-bridge-cli hd_screenshot        # window-bounded HD shot (resize <1500px before reading!)
adom-bridge-cli hd_log               # tail HD's log
adom-bridge-cli hd_launch            # start HD detached
# Direct HD control API (HTTP, no shell-escaping pain):
adom-bridge-cli hd_api '{"method":"POST","path":"/setup/run-all","body":{}}'
adom-bridge-cli hd_api '{"method":"GET","path":"/health"}'
```
`hd_api` hits HD's **control API** on its discovered port (fallback **47084**).
See the [[hydrogen-adom-desktop-windows]] companion for the host port-discovery file.

**Embedded-mode introspection (AD-served):**
```bash
adom-bridge-cli desktop_embedded_status   # embedded=true/false, enteredVia=launch-flag|runtime-adopt
```

## How the connection works (and how you check it)

```
You (AI in the workspace)
  └─ adom-bridge-cli <verb> '<json>'        ← CLI in the workspace
       └─ relay  (adom-bridge-cli serve: WS :8765 + HTTP :8766, started in the workspace)
            └─ WebSocket ──► HD's built-in bridge AND/OR the embedded AD on the user's machine
                 └─ acts on the OS / KiCad / Fusion / Chrome
```

- In HD the relay is started for you by the **`start-relay`** setup step; HD's
  built-in bridge and the embedded AD both connect to it. The host-side clients
  reach your in-workspace relay — the exact networking depends on the runtime
  (see the `hydrogen-networking` skill, and the [[hydrogen-adom-desktop-windows]] companion
  for the WSL2 loopback-forwarding details).
- **Always verify the bridge before acting on the host:**
  ```bash
  adom-bridge-cli ping       # → {"status":"connected", ...} means a client is reachable
  adom-bridge-cli status     # who's connected + .capabilities + which local apps are installed/running
  ```
  If `ping` fails, no desktop client is connected — tell the user, and (if needed)
  walk the `adom-bridge-cli` setup steps. Don't claim you acted on their machine
  without a successful round-trip. Don't try to "fix" a dead host client from in
  here — surface it.

## What NOT to do

- **Never kill the host AD process** — the host AD is your relay bridge;
  killing it severs your control channel (you can't get it back from in here).
  (Windows-specific `taskkill` warnings live in the
  [[hydrogen-adom-desktop-windows]] companion.)
- **Never hardcode `:9001` as HD's control API.** `9001` is real — it's AD's
  liveness beacon that AD probes to detect HD — but HD's actual control API is
  **47084** (use `hd_api`, which reads the discovered port).
- **Don't broad-kill `node`** — VS Code Server runs as node; killing it kills the
  whole workspace.
- Resize screenshots to `<1500px` before reading them, and inject every screenshot
  into shotlog with a real description.

## Mental model for answering the user

When the user asks for something that lives on their real computer — "save this
to my Desktop", "what's on my screen", "open this in KiCad", "run this command on
my machine" — that's an **AD** job, and you can do it. When it's about the
workspace itself (editor, files under `/home/adom/project`, the runtime), that's
**HD**. Lead with what you can do, verify with `adom-bridge-cli ping`, then act.

## Related skills
- [[hydrogen-adom-desktop-windows]] — Windows/WSL2 host specifics (paths, winget installs, loopback forwarding, taskkill)
- [hd-embedded-ad](../hd-embedded-ad/SKILL.md) — how HD bundles + embeds AD (tray, lifecycle, standalone↔embedded)
- [hydrogen-bridges](../hydrogen-bridges/SKILL.md) — the KiCad / Fusion / Puppeteer bridge ecosystem
- [hd-file-transfer](../hd-file-transfer/SKILL.md) — send/pull files, browse + watch the host filesystem
- [hydrogen-self-screenshot](../hydrogen-self-screenshot/SKILL.md) — host screenshots + window control
- [hd-recording](../hd-recording/SKILL.md) — screen vs tab recording (AD-served)
- [hydrogen-notifications](../hydrogen-notifications/SKILL.md) — desktop toasts; [hydrogen-captions](../hydrogen-captions/SKILL.md) — on-screen caption overlay
- [hydrogen-open-url](../hydrogen-open-url/SKILL.md) — the ways to open a URL (Pup, native browser, picker, …)
- `pup` — driving Pup browser windows; `adom-bridge-cli` — the full CLI verb reference
- [hd-runtime-mode](../hd-runtime-mode/SKILL.md) — the HD↔AD relationship is identical across runtimes
