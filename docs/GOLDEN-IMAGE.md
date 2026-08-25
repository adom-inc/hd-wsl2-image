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
Claude Code by a wide margin the largest thing in the image. The two payloads are largely
the same native build carried twice. Deduplicating them is the single biggest size win
available and is not attempted yet.

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

## The daemons

Four systemd units are baked into `/etc/systemd/system/`:

| Unit | What it does | Port |
|---|---|---|
| `code-server.service` | the editor backend, `--auth none`, opens `~/project` | 7380 |
| `adom-relay.service` | `adom-bridge serve`, the relay ah and Adom Bridge connect back to | 8765 / 8766 |
| `adom-shotlog.service` | the screenshot log server | 8820 |
| `adom-distro-id.service` | first-boot oneshot, mints `/etc/adom-distro-id` | n/a |

Two details that have bitten before, both now encoded in the units themselves.

The relay's binary was renamed from `adom-desktop` to `adom-bridge`, so its ExecStart
prefers `adom-bridge serve` and falls back to `adom-desktop serve`, with a dual
`ConditionPathExists=|`. The fat era hid this class of bug because the old binary was
always baked.

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
