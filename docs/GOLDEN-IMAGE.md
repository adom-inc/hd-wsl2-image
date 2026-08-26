# The Adom Hydrogen golden image (v25-full)

What is actually inside the WSL2 rootfs that Hydrogen imports when it provisions your
workspace, why each piece is there, and what every piece costs in megabytes.

Every number on this page was measured with `du -sm` inside the real v25-full build
distro on 2026-08-25, not estimated.

---

## Identity

| | |
|---|---|
| Artifact | `adom-golden-v25-full.tar.gz` |
| Download | 603,746,410 bytes (576 MiB) |
| Uncompressed rootfs | 1,965,086,720 bytes (1.87 GiB) |
| sha256 | `8e48c48595b065f4d47e4c5b6674c1687ed8b91c72ccc95ca775989b736ebc20` |
| Profile | `full` |
| Base | Ubuntu 24.04 (noble), systemd as PID 1 |
| Stamped at | `/etc/adom-golden-version` |

Two version markers matter and they answer different questions. `/etc/adom-golden-version`
is baked into the rootfs and says which image you are running. `/etc/adom-tarball-version`
is written by ah and says which image ah believes it imported. When they disagree, the
rootfs is the ground truth.

A third marker, `/etc/adom-distro-id`, is minted fresh by a first-boot oneshot on every
import, so two workspaces built from the same tarball are still distinguishable.

## full, not thin

The image ships everything preinstalled. That is a deliberate reversal of v24-thin,
which baked only the OS and made the setup cascade install the toolchain live, about
seven minutes on every first run.

The trap that drove the thin experiment was real: a fat image freezes package NAMES into
the rootfs for months, which is how retired slugs stayed pinned on live machines. v25-full
closes it a different way. Setup no longer installs, it converges: ah's `update-packages`
step runs the full install only when `adom_modules` is missing, and on a full image it
finds the tree and runs `adom-wiki pkg update` instead, which takes seconds. The image is
a warm cache. The registry stays the source of truth. A stale baked package converges away
on first run rather than living for months.

---

## Claude Code

Claude Code is preinstalled twice, on purpose, because it is two different products.

**The VS Code extension**, `anthropic.claude-code-2.1.245-linux-x64`, 384 MiB, installed
into `~/.local/share/code-server/extensions/`. This is the panel you type into inside the
editor, and the surface the AI Threads panel drives.

**The CLI**, 374 MiB in `~/.local/share/claude` with the launcher at `~/.local/bin/claude`.
This is what runs in a terminal tab, what TUI threads use, and what agents shell out to.

Together that is **758 MiB, about 38 percent of the uncompressed rootfs**, which makes
Claude Code by a wide margin the largest thing in the image.

They are not merely similar. They are **byte-identical**: both are a single file of
391,948,592 bytes with the same sha256 (`16ad2b94deaf7b29...`). The CLI tree is nothing but
that file, and the extension is that file plus about 10 MiB of JS, webview and manifests.

Which means the second install is avoidable, and this was verified on the build distro:
the extension's own copy runs standalone. `claude --version` answers 2.1.245 straight out of
`resources/native-binary/`, works with a clean HOME and no `~/.local/share/claude` present,
and `claude doctor` reports `Running: native (2.1.245)` with its Path inside the extension.
It links only against libc, librt and libpthread. The extension has been shipping a
complete, usable CLI all along; it was simply never on PATH.

So the image ships ONE copy. `~/.local/bin/claude` is a 719 byte wrapper:

```sh
b=$(ls -d "$HOME"/.local/share/code-server/extensions/anthropic.claude-code-*/resources/native-binary/claude \
     2>/dev/null | sort -V | tail -1)
[ -n "$b" ] || { echo "claude: no anthropic.claude-code extension found" >&2; exit 127; }
exec "$b" "$@"
```

A wrapper, not a link, and that distinction is the whole point. The extension directory is
version stamped, and VS Code REMOVES the old one when it updates, so a symlink would dangle
at the first update. The wrapper reglobs on every run, `sort -V` picks the highest version,
and an update needs no migration step at all. `exec` means argv, stdin, exit codes and
signals pass straight through, so callers cannot tell it from the binary. A missing
extension exits 127, the command-not-found convention, naming the directory it searched.

**Measured before adopting, because the risk was that the binary re-materializes itself:**

| invocation | result |
|---|---|
| `claude --version` / `--help` / `-p` | 1 MB, nothing written. Safe. |
| `claude update` | writes `~/.local/share/claude/versions/<v>` (374 MB) AND replaces the wrapper with its own symlink |

Neither `DISABLE_AUTOUPDATER=1` nor `autoUpdates:false` in `~/.claude.json` prevents the
second row. So normal use never duplicates, and an explicit update degrades to the old two
copy layout rather than breaking: you spend the disk back, nothing else changes. Three smoke
gates hold the line: the wrapper runs, it is still a REGULAR FILE (a symlink means the
standalone CLI was installed over it), and `~/.local/share/claude/versions` does not exist.

**The bigger win is not disk, it is version skew.** Two copies meant two independent
updaters, so the editor panel and the terminal could drift to different Claude Code
versions in one workspace. One binary and one updater makes that impossible. The tradeoff:
`claude`'s version is whatever the extension ships, and moves when it moves.

**Auth is unaffected**, which matters because the CLI is what signs you in. Credentials live
in `~/.claude/.credentials.json`, keyed to the user's home, not to where the binary sits.
Verified against this image: the cascade's own gate command,
`claude auth status --json 2>&1`, returns clean parseable JSON (`loggedIn:false`,
`authMethod:"none"`) with nothing on stderr. That last part matters, since the command merges
stderr and any stray warning would fail the parse and make setup conclude auth was broken.

Neither is version pinned. The bake installs whatever is newest that day (2.1.245 here)
and the CLI self-updates afterward.

**What is not baked is authentication.** Credentials cannot ship in a public artifact, so
signing in to Claude stays a human step in setup. ah's `install-claude-cli` step is
idempotent: on a full image it detects the baked binary and skips, which turns a roughly
30 second network install into an instant no-op.

Historical note, because it cost us: that step carried a comment since v15 asserting that
`claude.ai/install.sh` needs a live user session and therefore "can't bake reliably". That
was tested on the v25 build distro and is false. The installer is fully headless. Only auth
needs a human.

## code-server

531 MiB at `/usr/lib/code-server`, version 4.124.2. This is the VS Code backend that
Hydrogen renders. It runs as a systemd unit on `0.0.0.0:7380` with `--auth none`, opened
on `/home/adom/project`.

`--auth none` is safe here because the port lives inside your own WSL2 distro on your own
machine, and it is what lets Hydrogen embed the editor without an interstitial login.

The editor is seeded to open clean: no welcome page (`workbench.startupEditor: none`), no
Explorer, no bottom panel, no tabs. Just the activity-bar rail. The seeds that produce that
live in `workbench.html` and are asserted by the bake, so a future bake that loses them
fails rather than shipping a cluttered first impression.

**Port parity is a hard contract.** Web Hydrogen exposes every forwarded port through
`<host>/proxy/<port>/`, and the golden image must serve the identical code-server path
proxy so the same URLs work in both runtimes. `remote.autoForwardPortsSource` is pinned to
`hybrid` to match the cloud container exactly, which also means the "over 20 ports" popup
can never fire. Never fix a port problem by disabling forwarding.

## The workspace root

`/home/adom/project` is the workspace root, locked. Not `$HOME`.

It decides far more than the Explorer view: every integrated terminal starts there, every
relative path resolves from there, and `git clone` and `adom-wiki repo clone` default to
the current directory, so it is by construction where work accumulates. The cloud container
opens `~/project`, so the two runtimes must match or the same prompt puts files in
different places.

No symlinks in the workspace. Symlinks cause loops in `find`, ripgrep, build tools and file
watchers, and a link into `~/.local` drags the extension tree into the search index.

## The activity bar

The rail you see on the left is deliberately short. VS Code ships five default viewlets;
the image hides three of them.

| Icon | State | Why |
|---|---|---|
| Explorer | kept | you still browse files |
| Search | **hidden** | you ask the agent, and its grep beats the UI's |
| Source Control | **hidden** | the agent runs git in the terminal; the SCM viewlet is a GUI for a workflow it already owns |
| Run and Debug | **hidden** | launch configurations are a pre-AI ritual; the agent runs the thing and reads the output |
| Extensions | kept | you install and inspect extensions |
| Adom | added | adom-vscode |
| Claude | added | the Claude Code panel |

The point is not tidiness. Three of VS Code's five defaults are UI for jobs the agent now
does better from the terminal, and every icon left on that rail is a claim that clicking it
is the best way to do something. Hiding them is the honest position.

**How it is done.** Not through settings.json, because there is no setting for viewlet
visibility. VS Code stores it in IndexedDB, so the seed is a script injected into
code-server's `workbench.html` that opens the `vscode-web-state-db-global` database and
writes `workbench.activity.pinnedViewlets2` with `workbench.view.search`,
`workbench.view.scm` and `workbench.view.debug` marked `visible: false`. The same script
sets `http.linkProtectionTrustedDomains` to `["*"]`, which is what suppresses the "do you
want to open this external website?" dialog.

**The write alone does nothing, and this cost a full debugging cycle to learn.** Two traps:

- `pinned` is the field that hides an icon. `visible` is NOT: in a live image every entry
  carries `visible:false`, including Explorer and Extensions, which are plainly on the rail.
- The write must be followed by a forced RE-READ. The running workbench persists
  `pinnedViewlets2` from its own live UI state, so a write that is not immediately followed
  by a reload gets reverted by its owner. The symptom is maddening: the guard key lands, the
  write reports success, and the icons are still there.

ah's `/demo/run hide-activitybar` has always done both, write then reload. The seed now does
the same, and self-reloads only when it is the top-level document (`window.top === window`),
so a bare browser fixes itself while inside ah the iframe reload stays ah's job and no user
ever meets a "Reload site?" prompt on first run.

Verified on v25-full: the rail went from
`Explorer, Search, SCM, Debug, Extensions, Adom, Claude` to
`Explorer, Extensions, Adom, Claude Code, Accounts, Manage`.

**It is a default, not a policy.** The write is guarded by an `adom.activityBarSeeded` key
and runs once per profile. Right-click the rail and turn Search back on and it stays on,
forever. We are choosing the starting position, not taking the icons away.

A sibling seed, `adom.sidebarSeeded`, collapses the primary sidebar once, so first load is
the rail and the editor with no panel open. Two settings finish the shape:
`workbench.activityBar.location: default` keeps the rail visible (an earlier era hid the
whole bar, which was too far), and `workbench.activityBar.iconClickBehavior: toggle` makes
clicking the active icon collapse the sidebar instead of doing nothing.

**Three layers apply it**, because it silently failed once. The seed is baked into
`workbench.html` in the image and the bake fails if the `__hdAbSeed` and
`adom.sidebarSeeded` markers are missing. ah's `configure-vscode` step re-patches
`workbench.html` if it finds the seed absent, backstopping a bake gap. And the `welcome`
step re-asserts the hide after the workbench has actually loaded, where a failure is
logged as cosmetic rather than fatal.

## adom-vscode

The extension is under 1 MiB (`adom.adom-vscode-1.1.20`) and its CLI is 2.4 MiB at
`~/.local/bin/adom-vscode`. It punches above its weight: it is how everything outside the
editor reaches inside it.

adom-vscode exposes an HTTP control surface on **port 8821** from within the editor
frontend. ah drives the workbench through it (webview panels, tab placement, layout hides,
tab alerts), and `adom-cli` and agent skills use the same endpoint to open a webview, name
a tab, split a pane, or flash a tab orange. That is the answer to "how does the CLI talk to
the frontend": not by automating the UI from outside, but by calling this API, which is why
tab NAMES are the stable handle and tab ids should never be cached.

The port is registered `onAutoForward: silent` so it never raises a notification, and the
setup cascade keeps a verification sliver whose only job is to confirm :8821 came alive.

## How ah runs commands inside the container

There are two transports, and which one is used decides whether WSL wedges.

**wsl.exe, the bootstrap transport.** ah spawns
`wsl.exe -d Adom-Workspace -u adom -- bash -lc <cmd>` on the Windows host. It is the only
way in before anything is running inside the distro, so the import, the systemd boot, and
starting code-server must use it. It is also the origin of nearly every "WSL is flaky"
incident, and the defenses in the code say so out loud:

- **One global mutex serializes every wsl.exe call**, because a second call touching the
  distro mid-boot corrupts it PERMANENTLY into `Wsl/Service/E_UNEXPECTED`. Proven on a test
  VM: an undisturbed import boots and execs in 20 seconds, but overlapping health, status
  and version execs landing in that window corrupt it, after which the import appears to
  succeed and every later exec returns -1.
- That lock had to be **moved into the shared crate** because while it lived in the app
  crate it guarded only half the callers, so ah could still race itself into the corruption
  the lock existed to prevent.
- **A wedge watchdog** flips the runtime to `WSL_WEDGED` after three consecutive timeouts,
  and a self-heal runs `wsl --shutdown` and retries once when it sees `E_UNEXPECTED`,
  `Catastrophic failure`, or `HCS_E_CONNECTION_TIMEOUT`.
- **A choke-point guard** refuses execs while the user has the workspace stopped, because
  any exec into a terminated distro silently auto-starts it.

**The adom-vscode exec API, the native transport.** Once the editor is up, the container
exposes `POST /exec` (buffered) and `POST /exec/stream` (SSE) on the adom-vscode port,
normally 8821. The extension host runs the command itself, inside the container, as `adom`,
through a login shell, which is the same shape wsl.exe provided. Login matters: tools need
the workspace environment from `/etc/profile.d/`, and a bare `-c` shell runs them env-less
so they fail with nothing on stdout.

Because mirrored networking puts the distro's loopback on the Windows host, ah can reach
that port directly. No wsl.exe, no global lock, no boot-overlap window, no accidental
distro start. The exec verbs are HD-local by policy: a cloud container answers
`exec_disabled_on_cloud` (403) and omits them from `/health`, because an arbitrary-shell
verb on an internet-facing container is exposure nobody needs.

**The routing rule** is therefore: bootstrap on wsl.exe because there is no alternative,
everything after the editor proves `:8821` is answering on the native path, and fall back
to wsl.exe whenever the native route is not usable (editor not up, cloud container,
output past the 64 KB buffered cap). A routing miss must never become a command failure.

Two details worth keeping in mind if you touch this. The port is **discovered, not
assumed**: adom-vscode prefers 8821 but moves up when it is taken, publishes the result in
`~/.local/share/adom-vscode/port.json`, and ah verifies by TCP connect rather than trusting
the file, after an incident where the extension sat healthy on 8822 while ah hammered 8821
and every editor command hung. And availability must be probed with a plain loopback
connect first, because resolving the port can itself fall back to a wsl.exe read, which
would inject a new exec into exactly the boot window that corrupts distros.

## adom-theme

Under 1 MiB (`adom.adom-theme-2.3.6`) plus the fonts. The default is **Adom Studio Dark**.

The image ships the theme pack with JetBrains Mono and Familjen Grotesk (OFL 1.1, license
texts beside the files) and deliberately **without Satoshi**, baked with
`ADOM_THEME_SKIP_SATOSHI=1`. Satoshi's license forbids distribution on public servers and
this tarball is a public artifact, so a bake that leaves `Satoshi-*.woff2` in the tree is a
license violation and the smoke gate fails on it.

Container-served webfonts do work for the editor, terminal, and markdown preview. The one
surface that cannot use them is the Claude chat webview, which is isolated and never loads
workbench webfonts. That is why Satoshi is installed into Windows per machine at setup
time, fetched from Fontshare directly, the channel the license actually sanctions.

## adom-wiki CLI

14 MiB at `~/.local/bin/adom-wiki`, the largest single Adom binary and the most important
one. It is the package manager, the registry client, and the installer that brought
everything else in the image.

The whole image is one command: `adom-wiki pkg install adom/hydrogen-windows-bootstrap`,
whose dependency tree resolves to `hydrogen-bootstrap` then `adom/core` and pulls the
entire ecosystem. After first boot it is also the updater: `adom-wiki pkg update`, driven
by the `adom/hook` prompt hook, is what converges the workspace to current.

The bake fetches this binary fresh every time rather than reusing a staged copy, after a
v19 incident where a stale pinned CLI shipped in an image.

## adom-cli

9 MiB of package at `adom_modules/adom/adom-cli`, with the binary at
`/usr/local/bin/adom-cli`. It is the container's own control CLI: identity and profile
lookups, container and workspace operations, webview and Hydrogen commands.

The bake gates on it specifically. It must be 0.5.12 or newer AND the string
`hd-proxy-url` must be present in the binary, verified with `LC_ALL=C grep -qa` because
plain grep false-negatives on this binary in a UTF-8 locale. That fallback is what lets
adom-cli reach carbon from an env-less non-login shell; without it, it 404s. A registry
regression to 0.5.11 fails the bake rather than shipping broken.

## PATH, and the four shell shapes

A human typing in a terminal never needs `export PATH`. Anything programmatic does. That
split is measured, not assumed:

| Shell shape | `~/.local/bin` on PATH | `claude`, `adom-wiki`, `adom-bridge`, `shotlog` |
|---|---|---|
| Login (`bash -lc`), a real terminal tab | yes, via `~/.profile` | found |
| Interactive non-login (`bash -ic`) | yes, via `~/.bashrc` | found |
| **Non-login non-interactive (`bash -c`)** | **no** | **not found** |
| `adom-cli` (any shape) | n/a, it lives in `/usr/local/bin` | always found |

`~/.bashrc` returns early for non-interactive shells (`case $- in *i*) ;; *) return;;`) and
`~/.profile` is not read at all, so a plain `bash -c` used to get only the PATH from
`/etc/environment`, which did not list `~/.local/bin`. The blast radius was every
non-interactive caller: cron jobs, systemd units, scripts, and agent tool calls that shell
out, any of which reaching for `claude` by bare name got "command not found".

**Fixed in v25-full**: the bake writes `/home/adom/.local/bin` into `/etc/environment`, the
one file all four shapes read. The literal path is safe precisely because this image has one
user at a locked uid and the folder contract is fixed; the file is not a shell script, so
`$HOME` would not expand anyway. The bake asserts the config and the post-import test
asserts the behaviour, since `runuser` inherits the caller's environment and cannot
reproduce the shape that matters.

**A related cleanup this made possible.** ah's cascade used to prefix every `claude` call
with `export PATH="$HOME/.local/bin:$PATH"`. That was cargo cult twice over: `dexec` runs
`bash -lc`, a LOGIN shell, so `~/.profile` had already prepended the directory on every
image including v24-thin, and now `/etc/environment` covers the non-login case too. Those
prefixes are gone. They would still be required under `dexec_root`, since root's profile has
no reason to add the adom user's bin dir.

### The four symlinks in ~/.local/bin

```
shotlog          -> /home/adom/.local/bin/adom-shotlog
claude           -> /home/adom/.local/share/claude/versions/2.1.245
adom-bridge      -> /home/adom/project/adom_modules/adom/adom-bridge/dist/linux/adom-bridge
adom-bridge-cli  -> /home/adom/project/adom_modules/adom/adom-bridge/dist/linux/adom-bridge
```

The first two are the installers' own shapes. `claude` pointing at a versioned directory is
how its self-update swings the pointer without touching PATH, so replacing it with a copy
would break updates.

The last two deserve attention: a binary on PATH pointing INTO the workspace root. The
workspace is documented above as symlink-free, and this is a link crossing into it, which
makes a PATH binary depend on the package tree staying exactly where it is. Clear
`adom_modules` to force a reinstall and `adom-bridge` dies as a dangling link rather than
reporting itself cleanly missing, and the relay unit's `ConditionPathExists` on that same
path stops waking. The fix belongs in `adom/adom-bridge`'s install script: install the
binary into `~/.local/bin` the way every other Adom CLI does, rather than linking to its
package payload.

## The daemons

Four systemd units are baked into `/etc/systemd/system/`, and one more that the distro
provides is enabled alongside them:

| Unit | What it does | Port |
|---|---|---|
| `code-server.service` | the editor backend, `--auth none`, opens `~/project` | 7380 |
| `adom-relay.service` | `adom-bridge serve`, the relay ah and Adom Bridge connect back to | 8765 / 8766 |
| `adom-shotlog.service` | the screenshot log server | 8820 |
| `adom-distro-id.service` | first-boot oneshot, mints `/etc/adom-distro-id` | n/a |
| `cron.service` | the distro's own cron, enabled by us so scheduled work survives a reboot | n/a |

### cron

The agent in this container schedules its own recurring work, so cron running on boot is a
product requirement rather than an apt detail. A real Adom container already carries a live
crontab driving the daily wiki digest at 6am Central.

The bake installs the `cron` package, then enables it with the same symlink shape as the
four units above, because systemd is not PID 1 inside the bake distro and `systemctl enable`
cannot run there. Debian's postinst normally does this itself through `deb-systemd-helper`,
but doing it explicitly is what gives the smoke gate something it can assert.

That assertion was missing until 2026-08-26. The gate checked the package and the `crontab`
binary while its own comment claimed "cron alive", so an image where cron never started
would have passed clean. It now asserts the `multi-user.target.wants/cron.service` symlink
exists **and** resolves, exactly as it does for the other units. Installed is not the same
as starts on boot, and only one of those is what the user gets.

Two details that have bitten before, both now encoded in the units themselves.

The relay's binary was renamed from `adom-desktop` to `adom-bridge`, and the unit still
carries a fallback to the retired name: a `bash -lc` ExecStart that runs
`adom-bridge serve` or else `adom-desktop serve`, plus a dual `ConditionPathExists=|`.

That fallback was wrong and has been removed; the unit now carries one `ExecStart` and a
single `ConditionPathExists`. It was unreachable, because the only machine
that could take it has the new unit and the old binary, and any image carrying the unit
also carries `adom-bridge`. It converts a clean failure into a restart loop: when the real
binary is missing, the `||` runs a command that does not exist, the unit fails, and
`Restart=on-failure` retries forever instead of saying "not installed". The `|` makes it
worse, since that is an OR, so a machine holding only the retired binary satisfies the
condition and starts the stale one, reviving a name we retired instead of letting the
updater converge it. And it drags a login shell into a service start purely to run a
`command -v` the condition already answered. The honest unit is one ExecStart, one
`ConditionPathExists`, no shell: a missing binary then leaves the unit inactive with
"condition failed", which is the truth and is one line in `systemctl status`.

`ConditionPathExists` is evaluated by systemd **at boot**. A binary that arrives later,
through a migration or a package install, does not wake the unit on its own. Anything that
provisions binaries after boot must explicitly `systemctl restart` them, which is what ah's
`post_migration_provision()` does after every image migration. Never remove that.

The retired `adom-workspace-updater` daemon must be absent, and the bake asserts it is.
Auto-update is the `adom/hook` prompt hook calling `adom-wiki pkg update`, not a daemon.

## The API key, and how the container knows its Adom identity

The Adom API key lives in two places with different lifetimes, and understanding the split
is the whole trick.

The **persistent** copy is `~/.adom/api-key`, an ordinary file in the adom user's home, so
it survives reboots and workspace migrations like any other user data.

The **runtime** copy is `/run/adom/api-key`, on tmpfs, which means it evaporates on every
shutdown. A systemd tmpfiles rule re-materializes it at every boot:

```
d /run/adom       0755 root root -
C /run/adom/api-key 0644 root root - /home/adom/.adom/api-key
```

`C` copies the persistent file into the runtime path if the target does not already exist.
So services and CLIs read a stable, predictable path (`/run/adom/api-key`, also visible as
`/var/run/adom/api-key`) while the durable copy stays in the user's home.

**The image ships neither.** A golden image is public and identical for everyone, so it
carries the machinery but never a credential. The key arrives during setup, via ah's
`inject-api-key` step, after you sign in with your Adom account. On a fresh image
`/run/adom` exists and is empty, which is correct, not a fault.

## What the agent is allowed to do

The image ships a Claude Code configuration, and today it is thinner than anyone assumes.
`~/.claude/settings.json` carries the update hook, the `opus[1m]` model default, and
exactly one permission rule:

```json
"permissions": { "allow": ["Bash(adom-wiki:*)"] }
```

Everything else, every `adom-bridge` verb, every `gh`, every `python3`, falls through to
auto mode's classifier on every call. No package in the tree writes `permissions` at all;
that single rule is unowned and hand-seeded.

The cost is visible in any long-lived workspace as a growing pile of hyper-specific one-off
allow rules, because `Bash(...)` rules are prefix matches on the literal command string and
our CLIs put flags before the verb (`adom-bridge --target X --ai-thread Y <verb>`). No
prefix can express "allow these verbs, not those", so approvals accumulate one command at a
time and never generalize.

The right lever is `autoMode`, a top-level settings key whose `allow`, `soft_deny`,
`hard_deny` and `environment` lists are natural language the classifier reads, and where
`"$defaults"` inherits the built-in rules rather than discarding them. The entry that
matters most is environment, because it supplies the fact the classifier cannot know: a
command here usually drives a machine the user owns, through a bridge that runs its own
approval gate, refusing any call without caller identity, demanding a per-call reason for
gated verbs, and showing both in the user's Activity Log. There are two gates; only the
container-side one is blind.

That configuration belongs in `adom/hook`, which every Adom user already installs through
`adom/core` and which already owns this file, so it converges to cloud and HD alike rather
than living only in the image.

One related editor setting: `claudeCode.initialPermissionMode` is `auto`, which is the
right default, while `claudeCode.allowDangerouslySkipPermissions` is `false`, which is what
removes Bypass permissions from the editor's Modes menu. Adom users are power users and the
row should be there for the ones who want it, with Auto still the default.

## Everything else that is configured

- **`/etc/wsl.conf`**: systemd enabled, default user `adom`, hosts and resolv.conf
  generated, interop on with `appendWindowsPath=false` so the Windows PATH does not leak
  into the Linux shell.
- **The `adom` user**: uid 1001, passwordless sudo, systemd linger enabled so user services
  run without an active login session.
- **`wsl --import` does not reliably honor the default user.** Imported distros commonly
  boot as root regardless of `wsl.conf`. ah runs `pin_default_user_adom()` after every
  import: it sets `DefaultUid=1001` in the distro's registry key, terminates so the change
  is re-read, and verifies `uid=1001(adom)`. Call sites should still pass `-u adom`.
- **Python parity libs**: requests, yaml, bs4, lxml, PIL, installed via apt rather than pip
  so PEP-668 never bites and no build toolchain is needed. The cloud container ships these,
  so an AI writing Python behaves identically in both runtimes. numpy is deliberately
  excluded (about 150 MiB with BLAS/LAPACK, no evidence our agents reach for it).
- **No C/C++ build toolchain.** The image runs pre-built binaries; nothing compiles at
  runtime. That toolchain was about 246 MiB of dead weight in v1 through v14.
- **No private infrastructure.** No gallia checkout, no check-updates.sh hook, no GitHub
  auth, no model pins, no shared telemetry id. All smoke-gated.
- **The whole package tree is sudo-free.** The updater daemon was the only package that
  needed sudo and it is retired, so a `needs_sudo` package sneaking back in fails the bake.

---

## What the image does to setup

Hydrogen's setup cascade is 20 steps. The golden image does not remove steps, it empties
them. A step that used to do work becomes a step that verifies the work is already done,
which is why setup stays honest: every gate still runs, it just passes instantly.

| # | Step | On a full image |
|---:|---|---|
| 1 | `ensure-workspace` | **Unchanged.** Downloads the tarball, verifies its sha256, `wsl --import`s it, pins the default user to uid 1001, starts the distro. This is the step the image IS. |
| 2 | `wait-codeserver` | **Baked.** The unit is in the image, so this is a boot wait, not an install. Also signature-checks that the listener really is code-server via `/healthz` rather than trusting an open port. |
| 3 | `update-packages` | **Converges instead of installs.** The whole point of v25-full. Finds `adom_modules` present and runs `adom-wiki pkg update`, seconds. On a thin image this same step is the 5 to 9 minute full install. Still gates on the artifact: hydrogen-bootstrap's installed version must equal the registry's latest. |
| 4 | `install-adom-vscode` | **Baked, verifies activation.** Installs nothing. Waits for your Adom sign-in, reloads the editor, and proves the :8821 control API answers. Every later editor action depends on it. |
| 5 | `set-env-vars` | **Per machine.** Writes `ADOM_CARBON_URL`, `ADOM_HYDROGEN_URL`, `VSCODE_PROXY_URI`. Cannot be baked: they name this workspace's live proxy. |
| 6 | `inject-api-key` | **Per user, never baked.** Writes your Adom session token to `~/.adom/api-key`, which tmpfiles then re-materializes at `/run/adom/api-key` on every boot. See the API key section above. |
| 7 | `configure-vscode` | **Mostly baked.** settings.json and trusted domains ship in the image; what remains is the runtime layout hides (sidebars, bottom panel, the Search / Source Control / Run and Debug activity-bar icons). |
| 8 | `ensure-adom-bridge-cli` | **Windows side.** Verifies the Adom Bridge companion app is running on the host. Nothing in the rootfs can satisfy this. |
| 9 | `install-brand-fonts` | **Deliberately not baked.** Installs Satoshi, JetBrains Mono and Familjen Grotesk into Windows per-user through Bridge's `font_ensure_brand`. Satoshi cannot ship in a public tarball, and the Claude chat webview cannot use container-served webfonts anyway. A font that fails is a warning, not a failure. |
| 10 | `start-relay` | **Baked unit, started here.** `adom-relay.service` is in the image; this starts it and confirms 8765/8766. |
| 11 | `test-direct-connect` | **Per machine.** Proves the fast container to desktop path works. |
| 12 | `test-relay` | **Per machine.** Registers the relay with Bridge for file streaming. |
| 13 | `test-adom-cli` | **Per machine gate.** Checks three route classes: carbon (api-key plus proxy to cloud), hydrogen-proxy reachability, and the AI-shell env that non-login agent shells inherit. That third channel was silently broken once, letting agent `adom-cli` calls escape to the real cloud, which is why it is gated separately. |
| 14 | `install-claude-cli` | **Baked as of v25-full.** Now an instant no-op that only acts if the binary is missing. See the Claude Code section for the v15-era belief this corrected. |
| 15 | `claude-auth` | **The one human moment.** Restores saved credentials if still valid, otherwise drives the in-editor sign-in and waits for you to click Authorize. Credentials can never be baked. |
| 16 | `ensure-sse` | **Per session gate.** The editor's live link to ah must be connected or the Welcome page's webview-open silently 409s. |
| 17 | `verify-workspace` | **Per session gate.** SSE connected is not enough: the frontend must push its rendered layout into the proxy's workspace state, or every panelId lookup 404s. |
| 18 | `welcome` | **Per user.** Opens Claude Code and sends the first prompt. |
| 19 | `verify-setup` | **Independent end-to-end gate.** Re-checks every artifact and trusts no prior step's self-report: the distro execs as the pinned image, code-server serves, :8821 answers, adom-cli authenticates, the Claude CLI runs, Claude is authenticated and its panel is at the chat box, the layout is synced. This is what makes a false "setup complete" impossible. |
| 20 | `open-welcome` | **The final hard gate.** Opens the "your workspace is ready" page, but only after 19 passed, so "ready" is never premature. |

Read down the right column and the shape of the image falls out. **Nine of the twenty steps
cannot be baked no matter how full the image gets**, because they are per-machine, per-user,
or per-session: your API key, your Claude credentials, your fonts on Windows, the URLs of
your live proxy, the relay handshake with your desktop, and the session gates that prove
the editor is actually talking to ah. A golden image is by definition the part of a
workspace that is identical for everyone. Everything that makes it YOUR workspace arrives
in these steps.

What v25-full actually bought is steps 3 and 14: the seven minute toolchain install becomes
a seconds-long converge, and the Claude CLI install disappears.

### Two step descriptions were stale

Both were user-visible text in the setup panel and both are now corrected:

- `update-packages` was labelled "Install Adom toolchain (first run: several minutes)",
  which would be a lie on a full image where it takes seconds. Now "Converge Adom
  toolchain", and the description explains both cases and how the step tells them apart.
- `install-claude-cli` claimed golden images "no longer bake the CLI (its self-setup needs
  a live user session)". False, and now the reason the CLI IS baked.

---

## Size breakdown

Measured with `du -sm` in the v25-full build distro. MiB, uncompressed.

| Component | Size | Share |
|---|---:|---:|
| Claude Code VS Code extension | 384 | 19.3% |
| Claude Code CLI (`~/.local/share/claude`) | 374 | 18.8% |
| code-server 4.124.2 | 531 | 26.7% |
| Ubuntu shared libraries (`/usr/lib/x86_64-linux-gnu`) | 198 | 10.0% |
| `/usr/share` (locales, docs, terminfo, ca-certs) | 196 | 9.9% |
| `/usr/bin` | 83 | 4.2% |
| Python 3 stdlib and parity libs | 68 | 3.4% |
| `adom_modules` package tree (22 packages) | 49 | 2.5% |
| Adom CLIs in `~/.local/bin` | 33 | 1.7% |
| `/var` | 18 | 0.9% |
| Skills (`~/.claude`, 197 skills) | 9 | 0.5% |
| `/usr/local` (adom-cli) | 9 | 0.5% |
| adom-vscode + adom-theme extensions | <2 | 0.1% |
| **Total rootfs** | **~1,987** | **100%** |
| **Compressed download** | **576** | 29% of rootfs |

The Adom CLIs, broken out:

| Binary | Size |
|---|---:|
| `adom-wiki` | 13.5 MiB |
| `adom-parts-search` | 4.4 MiB |
| `adom-mouser` | 3.2 MiB |
| `adom-digikey` | 3.2 MiB |
| `adom-jlcpcb` | 3.1 MiB |
| `adom-shotlog` | 2.7 MiB |
| `adom-vscode` | 2.4 MiB |
| `adom-bridge`, `claude`, `shotlog` | symlinks |

Three observations worth acting on:

1. **Claude Code is 38 percent of the image**, carried twice. Deduplicating the extension
   and CLI payloads would cut roughly 370 MiB uncompressed.
2. **code-server plus Claude Code is 65 percent.** Everything Adom actually adds (packages,
   CLIs, skills, extensions, theme) is about 93 MiB, under 5 percent.
3. **The 197 skills cost 9 MiB.** The thing that most changes how the workspace behaves is
   among the cheapest things in it.

Against v24-thin (322,670,230 bytes compressed), v25-full is about 281 MB more to download,
in exchange for the seven minute first-run install disappearing.

---

## How it is built

WSL2-native on a real machine, in a throwaway distro, never in Docker and never in the
cloud container:

1. stage the build context (`bake-in-distro.sh` and friends) at `C:\tmp\ctx`
2. `wsl --import` a fresh throwaway distro from `ubuntu-base.tar.gz`, never reusing one
3. run the bake as root inside it with `GOLDEN_VERSION` and `GOLDEN_PROFILE=full`
4. gate on `SMOKE-OK`
5. `wsl --export`, `gzip -9`, `sha256sum`
6. release both assets, then verify the public download really serves the bytes and hash

`image/bake-in-distro.sh` is the canonical recipe. `image/bake-via-bootstrap.sh` is the
Docker and CI translation and is kept in lockstep.

## How it is tested

Import the released tarball from its public URL into an isolated `golden-test-*` distro,
the exact path ah will use, and check that `/proc/1/comm` is systemd, that
`/etc/adom-golden-version` matches, that `adom-wiki --version` runs, and that the skill
tree is present. Then start code-server in that distro and look at it in a browser: clean
workbench, the three extensions present, and a server on some port reachable through
`/proxy/<port>/`.

Every throwaway distro is unregistered and verified gone when the run ends, so a test can
never hijack the real workspace's ports.

## The feedback rule

When a gap is found ("X isn't installed", "Y setting is wrong"), fix it in the bake recipe
AND add a build-failing smoke assertion for it. Gaps become permanent regression checks. A
future bake that loses the fix must fail, not release.

This is not theoretical. v25-full failed twice at its own gate before passing, both times
because assertions written for an older registry had gone stale, and both times the gate
was right to stop the build.
