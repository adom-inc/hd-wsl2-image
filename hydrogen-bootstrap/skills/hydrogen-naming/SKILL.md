---
name: hydrogen-naming
description: >-
  The Adom product naming doctrine, and the one rule that must never regress:
  every OS-visible install surface (Start Menu, desktop shortcut, taskbar
  search, Spotlight, app listings, installer filename) says "Adom Hydrogen",
  NEVER bare "Hydrogen" - because a new user types "adom" into taskbar search
  before they have memorized the product name. Also the shorthand table (ah,
  ab, hc, aw, nb, nbe, hbw, pup) and the dead legacy names (HD, AD, Hydrogen
  Desktop as external copy, Adom Desktop, hw, hdbw, abe). READ when naming
  anything user-visible: an installer, a shortcut, a window title, a wiki
  page, marketing copy, or when unsure what to call a product in prose.
  Trigger words - naming, product name, formal name, what do we call it,
  Adom Hydrogen vs Hydrogen, shortcut name, start menu name, installer name,
  search for adom, ah, ab, hc, aw, why adom in the name, naming rules,
  rename, brand name, app name.
---

# Adom Product Naming

Canonical source: the **adom/definitions** wiki page. This skill is the
operational summary so the rules survive in every workspace.

## The table

| Product | Everyday name | Formal Name | ai shorthand |
|---|---|---|---|
| The desktop app | **Hydrogen** | **Adom Hydrogen** | **ah** (ah win, ah mac, ah ubuntu) |
| The desktop bridge/relay | **Bridge** | **Adom Bridge** | **ab** (ab win, ab mac, ab ubuntu) |
| The hosted web app | **Hydrogen Cloud** | Adom Hydrogen Cloud | **hc** |
| The wiki | **the wiki** | Adom Wiki | **aw** |

Say the everyday name in speech and UI copy. Reach for the Formal Name when
the Adom association matters: executables, installers, app-store listings,
marketing, and the first mention in a public doc.

## THE INSTALLER RULE (John, 2026-08-09 - never forget this)

Every OS-visible install surface MUST carry the Formal Name **"Adom
Hydrogen"** (and "Adom Bridge" for ab):

- Start Menu entry, desktop shortcut, taskbar pin
- Installer product name and artifact filename ("Adom Hydrogen_x.y.z_x64-setup.exe")
- Add/Remove Programs entry, autostart registry value name
- macOS app bundle name / Spotlight

**Why:** a new user will inevitably open Windows taskbar search and type
**"adom"**, not "hydrogen", because they have not memorized the product name
yet. They know they installed something from Adom. If the shortcut says bare
"Hydrogen", that search finds NOTHING and the product looks broken or gone.
Adom must be in the installed name. That is the entire reason the Formal Name
exists as a register.

## Dead names - never write these

- **HD / Hydrogen Desktop** in any copy (chat, docs, UI, skills). Say
  Hydrogen or ah. (Code identifiers like `hd_*` verbs or `hd-` crate names
  are unrenamed call sites, not license to use the name in prose.)
- **AD / Adom Desktop** - the product is Bridge (ab). The CLI is
  `adom-bridge-cli`; the native launcher is `adom-bridge`.
- **hw** (now hc), **hdbw** (now hbw), **abe** (now nbe), bare single-letter
  shorthands (say ah, ab, aw - never h, b, w).

## Shorthand rule

Every shorthand is at least two letters. A natural one-letter shorthand takes
the Adom "a" prefix: **ah**, **ab**, **aw**. Anything already 2+ letters
never does: **hc**, **nb**, **nbe**, **hbw**, **pup**.

## Frozen internal identifiers (do NOT "fix" these)

These deliberately keep old spellings because they are load-bearing state or
build identity, renaming them breaks installs:

- Windows state dir `%APPDATA%\hydrogen-desktop`
- Bundle identifier `inc.adom.hydrogen-desktop`
- Cargo package `hydrogen-desktop` (the BINARY is `hydrogen.exe`)
- GitHub repo `adom-inc/hydrogen-desktop`
- WSL distro `Adom-Workspace`
