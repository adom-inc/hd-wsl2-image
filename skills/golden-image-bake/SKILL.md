---
name: golden-image-bake
description: "Rebuild + release the Hydrogen Desktop golden WSL2 rootfs image (adom-inc/hd-wsl2-image). Use when the user says \"bake the golden image\", \"rebuild the wsl2 image\", \"new golden image\", \"cut a new hd-wsl2-image version\", or when registry drift (bootstraps / CLIs / extensions) makes the shipped image stale. Registry-native: the whole image is ONE `adom-wiki pkg install adom/hd-windows-bootstrap`. Built WSL2-NATIVE on John's laptop via adom-desktop — never docker, never in the cloud container. EMPLOYEE-ONLY — never publish this skill to the wiki or into the public image."
---

# Golden image bake — adom-inc/hd-wsl2-image

## 🔒 DESIGN GOALS — NON-NEGOTIABLE INVARIANTS (read before changing ANYTHING)

**THE overarching goal: Hydrogen Desktop must behave as close to Web Hydrogen
(the cloud Docker container) as possible.** Every golden-image decision is judged
against "does this match how Web Hydrogen works?" If a change would diverge HD's
behaviour from Web Hydrogen, it is almost certainly wrong.

1. **PORT ACCESS VIA `<host>/proxy/<port>/` MUST WORK — this is how Web Hydrogen
   exposes ports and HD MUST replicate it.** In Web Hydrogen every forwarded port is
   reached through the container's DNS address + `/proxy/<port>/`
   (e.g. `https://<slug>.adom.cloud/proxy/<port>/`). HD must serve the identical
   code-server path-proxy route so the same URLs work. **NEVER disable port forwarding
   or break the `/proxy/<port>/` route.** This is in ADDITION to WSL2 **mirrored
   networking**, which also exposes WSL2 ports on the host's `localhost` — **BOTH must
   work.** (John has stated this requirement more than once — core design goal.)
   - PROVEN 2026-06-22: the `/proxy/<port>/` route is a static HTTP route, **independent
     of `remote.autoForwardPorts`** — a never-forwarded port still serves through it. You
     may tune auto-forward settings, but ALWAYS re-verify against a re-imported image
     (boot code-server, `python3 -m http.server N`, curl `…/proxy/N/`).
   - PARITY SETTING: the Web Hydrogen container sets
     `"remote.autoForwardPortsSource": "hybrid"` (verified by reading the live
     container's code-server settings; its `VSCODE_PROXY_URI=…/proxy/{{port}}/`). The
     golden image MUST match — pinning the source to `hybrid` means there is no
     `process→hybrid` switch, so the "Over 20 ports…" popup never fires. Do NOT "fix"
     that popup by disabling auto-forward or via `autoForwardPortsFallback`.
2. **Clean first-load editor:** opens to an empty workbench — no Explorer sidebar, no
   bottom panel, no tabs, no welcome page (just the 48px activity-bar rail). Seeded
   per-workspace in hd-windows-bootstrap's workbench.html + `startupEditor:none`.
3. **No C/C++ build toolchain** — the runtime image runs PRE-BUILT binaries; nothing
   compiles at runtime (there is no rustc). The toolchain was ~246 MB of dead weight in
   v1–v14. Keep code-server, node, gh, git, python3.
4. **Built from signed wiki.adom.inc packages via the `adom-wiki` CLI, NOT gallia and
   NOT adompkg (both retired here).** ONE declarative install:
   `adom-wiki pkg install adom/hd-windows-bootstrap` → core + hd-bootstrap + WSL2 layer
   + adom-desktop. No gallia clone / install.mjs / GALLIA_TOKEN anywhere in the image.
5. **WSL2-native bake, NEVER docker** (see [[feedback_golden_image_wsl2_never_docker]]).
6. **Workspace opens at `/home/adom`** (the home folder), not `/home/adom/project` —
   though the opened folder is ultimately an HD launch-time arg.
7. **Bootstrap script contract: `install.sh` (DONE 2026-07-20).** History: adompkg
   required `scripts.postinstall` on bootstraps; the new registry initially kept that
   validation while the CLI didn't execute postinstall — bootstraps couldn't have a
   working script at all. John's ruling: the postinstall/install split is pointless
   because dependency-ordered install already runs a dependent's `install.sh` after its
   deps. **Colby lifted the server validation; we migrated
   `adom/hd-bootstrap@0.2.23` + `adom/hd-windows-bootstrap@0.2.8` to
   `scripts.install`** — verified clean-HOME: 51 skills + settings.json, dependency
   ordered, no shim. `scripts.postinstall` is deprecated (publish warns
   `POSTINSTALL_DEPRECATED`; hard-reject is staged, gated on all three HD bootstraps
   migrating — `adom/hd-mac-bootstrap` (Kyle) was the last straggler).
8. **ALWAYS RESOLVE LATEST — NEVER PIN PACKAGE VERSIONS (John's call, 2026-07-20).**
   The bake installs unpinned ON PURPOSE: John wants "give me whatever is newest right
   now." Do NOT add version pins for reproducibility, and do not propose it again. The
   tradeoff is understood and accepted: the same script on different days produces
   different images (v18 got hd-bootstrap 0.2.10; v19, four days later, got 0.2.23 + 2
   extra skills). REPORT what drifted in the release notes; ship latest regardless.
   Corollary — same rule for the toolchain: **fetch the `adom-wiki` CLI fresh at bake
   time, never reuse a staged/pinned binary** (see the v19 stale-1.0.41 incident below).

When in doubt about ANY of the above, VERIFY empirically against a re-imported image
(boot code-server, test the actual behaviour) before changing the bake — do not guess.

## What this builds

A flat WSL2 rootfs that HD `wsl --import`s. The OS "hardware" (apt baseline,
code-server, systemd, user/linger/pam) is baked by the script; ALL Adom content
(skills, CLIs, extensions, editor config) arrives through the single registry install.

Repo: `/home/adom/project/hd-wsl2-image` (github.com/adom-inc/hd-wsl2-image, public).
**Canonical recipe: `image/bake-in-distro.sh`** (WSL2-native, runs as root inside a
throwaway `wsl --import`ed ubuntu-base distro on the laptop).
`image/bake-via-bootstrap.sh` is the docker/CI translation — keep them in lockstep.
`image/Dockerfile` + `.github/workflows/build.yml` are the CI path (also registry-native
now; CI stages only the `adom-wiki` binary, no private clones).
Legacy/retired: `bake-hd-setup.sh`, `scripts/build-rootfs.sh` (gallia+chroot era),
`image/public-scrub.sh` (existed only to strip gallia's check-updates hook — the
registry-native bake never creates it), `image/adompkg/` (adompkg is deprecated).

## Procedure — WSL2-native on the laptop via adom-desktop

Everything runs through the AD relay against `AdomLapper`. **If two ADs are connected
(winvm + AdomLapper) every call needs `--target AdomLapper`** or you get
`ambiguous_target`.

```bash
# 0. stage the build context on the laptop: C:\tmp\ctx\
#    wsl.conf, init-host-internal.sh, bootstrap.sh, bake-in-distro.sh (+ any overlay binary)
#    NOTE: send_files ALWAYS lands in C:\Users\john\Downloads and IGNORES destDir —
#    move files into ctx with a follow-up PowerShell run_script.
#    DO NOT stage adom-wiki: the bake fetches it fresh (invariant 8 corollary).

# 1. fresh throwaway distro (never reuse — a used distro carries prior state)
adom-desktop --target AdomLapper wsl_unregister '{"distro":"golden-build"}'
adom-desktop --target AdomLapper wsl_import '{"distro":"golden-build","installDir":"C:\\tmp\\golden-build-vN","tarball":"C:\\tmp\\ubuntu-base.tar.gz"}'

# 2. copy ctx in, then bake (async — held session keeps /tmp alive, no mid-bake shutdown)
#    wsl_exec / run_script take a base64 `scriptB64`, NOT a raw command string.
adom-desktop --target AdomLapper wsl_exec_async '{"distro":"golden-build","user":"root","scriptB64":"<b64 of: export GOLDEN_VERSION=vN; bash /tmp/ctx/bake-in-distro.sh>"}'
adom-desktop --target AdomLapper wsl_job_status '{"jobId":"wsljob-…"}'   # poll until running:false

# 3. gate on SMOKE-OK in the output. The bake has an ERR trap that prints the failing
#    line number — a bare `exit 2` with no message means you are on an old copy.

# 4. export + compress + hash (gzip -9 takes ~4 min for ~450 MB)
adom-desktop --target AdomLapper wsl_export '{"distro":"golden-build","tarball":"C:\\tmp\\adom-golden-vN.tar"}'
#    then in the Ubuntu distro: gzip -9 -c … > …tar.gz && sha256sum … | tee ….tar.gz.sha256

# 5. release BOTH assets (tar.gz + .sha256 sidecar)
gh release create vN --repo adom-inc/hd-wsl2-image --title "…" --notes-file …
gh release upload vN …tar.gz …tar.gz.sha256 --repo adom-inc/hd-wsl2-image --clobber
#    big uploads must be DETACHED (Start-Process) + polled; they exceed the relay timeout.

# 6. VERIFY THE PUBLIC DOWNLOAD (never skip — released ≠ verified)
curl -sIL <url> | grep -iE '^HTTP|^content-length'    # 200 + exact byte match
curl -sL <url>.sha256                                  # matches what you baked
curl -sL --range 0-3 <url> | xxd -l2 -p                # 1f8b (gzip magic)
```

## Verification gates (make every requirement a build-FAILING litmus)

Put each requirement in the bake's smoke test so a bad image cannot be produced, and
then re-verify independently in the finished image. Current gates: version stamp,
adom-wiki present/runnable, no stale adompkg, required modules present, RETIRED packages
absent (`adom-workspace-updater`, `hd-skillpack`), sudo-free tree, no gallia checkout, no
private `check-updates.sh` hook, ≥45 hd-* skills + spot-checks, settings.json keys
(`chat.agent.enabled:false`, `startupEditor:none`, `autoForwardPortsSource:hybrid`),
workbench seeds (`__hdAbSeed`, `adom.sidebarSeeded`), claude-code extension, systemd +
linger, ownership, no build toolchain.

## Hand-off to HD

HD consumes the image via three consts in
`hydrogen-desktop/src-tauri/crates/hd-app/src/runtime/wsl.rs`:
`TARBALL_URL_PLACEHOLDER`, `TARBALL_SHA256_PLACEHOLDER`, `TARBALL_VERSION` (+ a
byte-count comment). **The tarball FILENAME is pinned in code**, so a new version needs
an edit + rebuild — it is not picked up automatically. Give the HD thread URL + sha256 +
byte size + version, and say what drifted.

⚠️ **Pin/code pairing:** if the image drops something HD still re-installs at launch,
the pin must ride the branch that removes that code (v18's updater retirement rode
`feature/retire-workspace-updater`, NOT main — main's `ensure_workspace_updater()` would
have re-installed the retired daemon into a clean image).

## HARD-WON TRAPS (each cost real time — read before debugging)

- **A pinned CLI silently ages out.** v19 was baked with an `adom-wiki` 1.0.41 binary
  staged during v18; it hit an ALREADY-FIXED bug, and I reported that stale-binary
  artifact as a live ecosystem problem (and escalated it to two people). **Fetch tools
  fresh; compare against the registry before asserting any tooling bug.**
- **`grep -q` false-negatives on binaries.** Checking a string in a Rust binary
  (`hd-proxy-url` in adom-cli) failed with plain `grep -q` under a UTF-8 locale
  (invalid multibyte sequences) even though the literal was present. **Use
  `LC_ALL=C grep -qa`.** And `strings` DOES NOT EXIST in the image (binutils stripped in
  v15) — a `strings | grep -c` check returns a misleading `0`.
- **Version compares:** use `printf '%s\n%s\n' "$MIN" "$V" | sort -V -C`, and TEST it
  across the boundary (0.5.11 fail / 0.5.12 pass) so the gate is a real discriminator.
- **Platform-specific packages need `?platform=` on the tarball API.**
  `/api/v1/packages/hd-windows-bootstrap/0.2.7/tarball` 404s;
  `…/tarball?platform=linux` works. A 404 reads like "version missing" — it isn't.
- **Never rebuild a publish dir by extracting the published tarball.** The hero is
  deliberately excluded from tarballs via `files[]` (it is a PAGE asset), so the publish
  then fails the hero lint. Publish from source with `docs/hero.png` present; `files[]`
  keeps it out of the tarball. (Heroes in tarballs = bloat: adom/core shipped 1.6 MB for
  ~2.3 KB of payload — filed as adom/core issue #3.)
- **VirtualBox cannot test WSL2.** No nested virt on a Hyper-V host, so the VBox harness
  only exercises installer/cascade UX — it CANNOT prove the image imports. Import proof =
  a real WSL2 box (laptop throwaway import, or the Azure winvm for a full virgin E2E).
- **The vm-test harness needs `export ADOM_TARGET=AdomLapper`** when two ADs are
  connected, or its helpers die with `ambiguous_target` right after "STAGE 1".
- **The laptop HD checkout `C:\Github\hydrogen-desktop` is SHARED across threads.**
  Check `git branch --show-current` + stash state before switching; restore it after.
- **Mutating commands are NOT idempotent — never blind-retry.** Re-running
  `adom-wiki issue create` because the output PARSE failed created a duplicate issue.
  Verify state, then retry.
- **`git commit -m "…" | tail` can hang** in this container (shell alias); use
  `git commit -F <file>` and check `git log -1` to confirm it landed.

## Version history (what changed, so future bakes have context)

| ver | change |
|---|---|
| v15 | dropped the ~246 MB C/C++ toolchain + stripped docs/man/locales (626→400 MB) |
| v16 | clean first-load editor (per-workspace sidebar-collapse seed, no welcome/tabs/panel) |
| v17 | Web Hydrogen port parity: `autoForwardPortsSource: hybrid` (kills the >20-ports popup) |
| v18 | REGISTRY-NATIVE: `adom-wiki pkg install` replaces adompkg/gallia; workspace-updater + hd-skillpack RETIRED; tree sudo-free |
| v20 | python parity libs baked (`python3-{requests,yaml,bs4,lxml,pil}` via apt — Web Hydrogen parity; NO numpy); `definitions` skill litmus (core@4.13.4 depends on adom/definitions — guard it); adom-cli source-overlay REMOVED (registry adom/adom-cli@4.0.5 now ships 0.5.12); PEP-668 install guidance added to the hd-container skill |
| v19 | adom-cli 0.5.12 overlay (`~/.adom/hd-proxy-url` fallback for env-less shells); bake fetches adom-wiki fresh; postinstall shim removed (bootstraps now `scripts.install`). **Shipped in HD 0.1.170** (pin 4c3f159b); virgin fresh-install PASSED 20/20 cascade, and the fix was proven in the ACTUAL failure condition — `env -u ADOM_CARBON_URL -u ADOM_HYDROGEN_URL adom-cli hydrogen webview open-or-refresh` returned `created` instead of 404ing against carbon. HD also hardened its `test-adom-cli` setup gate to cover the AI-shell (code-server systemd env) channel, so this class of regression now HALTS setup. |

**Verification lesson (v19):** a version string is not proof a bug is fixed. Reproduce the
ORIGINAL failure condition — for env/base-url bugs that means `env -u <VAR>` to strip the
vars that were masking it in a login shell. Prefer a runtime gate in HD's setup cascade over
a bake-only assertion when the failure is runtime-shaped (env, sessions, networking).

## Size anatomy + what's installed (measured v20, 2026-07-20)

- **Served COMPRESSED.** HD downloads the `.tar.gz` (v20 = 456.5 MB); it expands to
  ~1.4 GB (tar) / ~1.5 GB on disk after `wsl --import`. Quote the compressed number for
  "how big is the download," the extracted for "how much disk it costs the user."
- **The claude-code VS Code extension is the single biggest thing: ~271 MB** extracted
  (`anthropic.claude-code-*`), i.e. > half of `/home`. It grows with each extension
  version. It is NOT ours to trim; if image size ever becomes a real problem, the
  conversation is whether HD injects it at runtime instead of baking it. code-server
  itself is ~531 MB — the irreducible floor.
- **`adom_modules/.cache` (~28 MB) is adom-wiki's download cache** — pure waste, cleaned
  in the slim pass as of v20 (adompkg never left one, so the pass used to miss it).
- The v17→v18 +53 MB was NOT "core got fatter" (it got LEANER) — it's the adom-wiki
  binary (+13 MB vs the tiny adompkg.mjs), the .cache (+28 MB, now cleaned), and
  claude-code-extension version growth.

**DEPENDENCY DIRECTION (get this right):** the bake installs the LEAF
`adom-wiki pkg install adom/hd-windows-bootstrap`, which pulls hd-bootstrap → core down
as DEPS. Installing `adom/core` alone gets you NONE of the HD layers (core is the base;
it doesn't know they exist). "Removed from core's deps" ≠ "removed from the image."

**⚠️ CORE RESTRUCTURING CAN SILENTLY DROP PACKAGES.** `core@4.9` (v17) depended on
`pup`, `screenshot-paste`, `fusion-export-for-hydrogen`, `fusion-update-libraries`;
`core@4.13` (v20) DROPPED all four, so the image silently lost them. digikey/jlcpcb/
mouser survived but were RENAMED (`digikey`→`adom-digikey`) + reparented under
`adom-parts-search`. LESSON: anything HD genuinely needs should be an EXPLICIT dep of
`adom/hd-bootstrap` (which we own), not left to `core`'s churn — and the smoke test
should carry an "expected apps present" litmus so a dropped package FAILS the bake.
v20 registry set (24 pkgs): apps = adom-cli, adom-desktop, adom-digikey, adom-jlcpcb,
adom-mouser, adom-parts-search, adom-vscode, adom-wiki-cli, hook, prose-lint, step2glb;
skills = adom, adom-cli-design, adom-ui-design, adom-workspace-control, app-creator,
building-adom-apps, definitions, prose-style, ralph-loop-test, wiki; + 51 bundled hd-*.

## Python libraries (v20)

Baked via apt (NOT pip — PEP-668): `python3-{requests,yaml,bs4,lxml,pil}` for Web
Hydrogen parity. Added ~0 compressed size (they compress well + the image is dominated
by the claude-code extension). **numpy is the one remaining parity gap and the ONLY
expensive one** (~150 MB extracted / ~40 MB compressed with BLAS/LAPACK — those binary
libs don't compress like text) — keep it OUT unless there's real demand. Do not
speculatively pile on "popular" libs; the parity set + the PEP-668 escape-hatch in the
hd-container skill (apt python3-<lib> / pip --break-system-packages / venv) covers the
long tail without image growth.

## Retired (do not resurrect)

- **adom-workspace-updater daemon** — retired in v18; in-distro auto-update is now
  `adom/hook` → `adom-wiki pkg update`. The bake ASSERTS it is absent.
- **hd-skillpack** — skills ship bundled inside the bootstraps. Asserted absent.
- **gallia** — never invoked; `adom/core` is the new gallia. No clone, no token.
- **adompkg** — deprecated in favour of the `adom-wiki` CLI.

## Standing cleanup

- (RESOLVED 2026-07-20) The v19 adom-cli source-overlay is GONE. Colby published
  `adom/adom-cli@4.0.5` shipping the 0.5.12 binary, so v20 removed the overlay — adom-cli
  is registry-managed again. The litmus stayed and now validates the registry binary.
- Nothing else pending.
