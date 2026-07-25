# Adom bootstrap layering + naming convention

Decided by John + Claude (wsl2-image thread, 2026-06-18). This is the
architecture the golden WSL2 image is moving toward. Not yet built — it
gates on the `adom/core` contract facts below being verified.

## The model: composable bootstraps, `core` is the universal root

A **bootstrap** is an adompkg package (`type: bootstrap`) whose *dependency
list is its install set* — skills, CLIs, apps — plus an optional install
hook for environment config. "Layering" is not a special feature: a layer
is just a bootstrap that **depends on** the bootstrap below it. Resolution
is additive; lower layers are pulled unmodified, never forked or curated.

```
                    adom/core              ← universal base; every layer deps it
                   /     |      \
          adom/hd-bootstrap  ntx/bootstrap  cosmiic/bootstrap
                                              ← peers; each adds its own packages
   (a customer wanting "HD + NTX" installs both; core resolves ONCE via semver)
```

It's a DAG with `core` as the root, not a strict stack. Most vendor value
(hardware, PCBs, parts, design skills) is runtime-agnostic, so vendors layer
on **core** and compose with *any* environment (HD or web Hydrogen). A vendor
layers on **hd-bootstrap** only for something that genuinely needs HD's
runtime (a tab integration, a bridge).

## Naming convention

> **`core` is the sole exception** — the universal root, named for what it
> is. **Every other bootstrap is `…bootstrap`**: bare `<org>/bootstrap` when
> a namespace holds one, qualified `<layer>-bootstrap` when a namespace holds
> several.

- `adom/core` — the one root everyone (incl. vendors) layers on. Keeps its name.
- `ntx/bootstrap`, `cosmiic/bootstrap` — a vendor org owns its whole
  namespace, so the brand is the namespace and `bootstrap` alone is
  unambiguous. "I use Cosmiic" → AI finds `cosmiic/bootstrap`.
- `adom/hd-bootstrap` — HD is an Adom **product**, not a third-party org, so
  it ships under `adom/` alongside `core` and **must** carry the `hd-`
  qualifier (`adom/bootstrap` would be ambiguous — which Adom bootstrap?).

HD does **not** get its own `hd/` namespace: it's internal to the platform.
Owning the qualifier is the convention correctly distinguishing "the
platform's internal layer" from "an external org's ecosystem."

## Promotion: one artifact, two delivery moments

The bootstrap is identical regardless of how it reaches a machine; only the
*trigger* differs.

- **Vendor (NTX/Cosmiic): lazy, runtime, AI-discovered.** User says "I'm on
  the Cosmiic ecosystem, am I set up?" → AI recognizes it names a bootstrap,
  finds `cosmiic/bootstrap`, diffs vs installed, converges. Pull-based.
- **Adom HD: eager, build-time, pre-baked.** We own the environment, so we
  run the *same* `adompkg install adom/hd-bootstrap` at bake time and ship
  the WSL2 image already-converged. No discovery — first boot is set up.

**The bake is an optimization of the runtime flow, not a different
mechanism.** Two properties this forces on `adom/hd-bootstrap`:

1. **Installable live** — it must converge correctly from a cold
   `adompkg install` on an already-running workspace, never assume it was
   baked. (Bonus: lets us test it without baking.)
2. **The discovery + convergence engine is a `core`-level capability**, not
   the vendor's. utterance → find bootstrap → diff → install. It's the
   *runtime twin* of HD's workspace-updater (updater : HD :: "am I set up?"
   : vendor — same diff-against-a-manifest engine, different trigger).
   Vendors just publish a well-formed bootstrap; the engine does the rest.

## What goes in which layer — the litmus

**Knowledge vs. orchestration**, not topic:
- **Capability knowledge** ("what InstaPCB is / how quoting works / what EDA
  tools exist") → lives in the lowest layer that owns it, i.e. **`core`**.
  True everywhere.
- **HD runtime + HD orchestration of that capability** ("auto-open the quote
  in HD's second tab, run the watch→reload loop") → **`adom/hd-bootstrap`**.
- **Rule:** an HD-layer skill may *orchestrate* an ecosystem capability but
  must **defer to the core skill for the knowledge, never embed/duplicate
  it.** If an `hd-*` skill teaches *what InstaPCB is*, it's in the wrong
  layer. A leaky HD layer poisons every vendor stack built on it.

Audit (2026-06-18): ~41 of 44 `hd-*` skills are genuinely HD-runtime-specific
and correctly placed. Three are "onboarding playbooks that wrap an ecosystem
capability" and need thinning (orchestration stays in HD, knowledge moves to
core): **hd-instapcb** (clear), **hd-eda-discovery** (clear), **hd-captions**
(soft — may be genuinely HD's caption surface; inspect before touching).

## `adom/hd-bootstrap` = composition + the bake collapses

The golden image collapses to two things:
1. **Dockerfile = the "hardware"** — apt baseline, code-server, systemd, the
   user/linger/pam fixes. The OS the bootstrap runs *on*.
2. **`adompkg install adom/hd-bootstrap` = the "config"** — everything
   `bake-hd-setup.sh` does by hand today (gallia install.mjs, the 44-skill
   copy, the 8 CLI installs) becomes ONE declarative manifest John owns.

`adom/hd-bootstrap` = deps (`adom/core` + the HD-runtime skills + the
workspace-updater + any HD-only CLI) **plus a thin install hook** for the HD
environment config that isn't a package: VS Code `settings.json`, the
`workbench.html` trusted-domains/activity-bar patches, code-server config,
systemd daemon wiring. So it's not a pure meta-package — it has a small body.

**Stays OUT of the bootstrap** (per-machine/runtime, injected by HD at
`wsl --import` time): the Carbon API key, `DefaultUid=1001`, the
`host.docker.internal` alias.

This also **dissolves the "curate gallia for HD" approach**: gallia's two
jobs split — its ecosystem skills become `core`'s job (shared with web
Hydrogen), its HD config/settings-deploy becomes `adom/hd-bootstrap`'s hook.
Nothing gets HD-flavored on the way in.

Public repo / reference design: **public, but no source code for now** — a
bootstrap is a manifest + a thin hook + a README. The README *is* the vendor
guide ("how Adom built its layer on core; do this"). NTX/Cosmiic copy the shape.

## Blocking: the `core` contract (verify ourselves; inform Colby, don't ask)

These are facts about Colby's code; verify with adompkg directly, and if
reality falls short, tell Colby what `core` needs. None are permission-asks.

1. **Anonymous install** — `adompkg install adom/core` must succeed with NO
   token and NO `--allow-sudo`. (Token-less it wanted sudo + died resolving
   `kyle/step2glb`.) The bake runs fully anonymous.
2. **Name alignment** — core's short dep names (`adom/mouser`, `adom/digikey`,
   `adom/jlcpcb`, `adom/parts-search`) must resolve to the *same* registered
   packages as the wiki apps (`adom-mouser` etc.), so layers can't
   double-install divergent versions.
3. **Hook ordering** — adompkg must run layered install hooks deepest-first
   and deterministically (core → hd → vendor), so hooks don't race.
4. **Core semver stability** — a stable major downstream layers can pin
   (`adom/hd-bootstrap` deps `core ^N`); else the diamond won't resolve.

Open (Colby-side gap to flag, not block on): is there a `core` skill doing
utterance→bootstrap discovery + convergence, so vendors only publish a
well-formed bootstrap?

## Sequence (v14 paused until this is agreed + core contract green)

1. Verify the `core` contract (above) — the long pole.
2. Define `adom/hd-bootstrap` = `core` + `hd-skills` + workspace-updater +
   install hook for the VS Code/workbench config.
3. Rewrite the bake to literally `adompkg install adom/hd-bootstrap`.

Open sub-decision: are the ~41 HD skills **one `adom/hd-skills` tarball** or
**individual packages**? Lean individual (the updater converges per-package,
so it can bump one without reshipping all 41) — cost is 41 publishes.
