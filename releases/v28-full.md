v28-full: v27 with the package update already applied.

This image is v27's base with today's `adom-wiki pkg update` baked in: the same packages every running v27 workspace has after its own update, nothing new below the package layer. Its purpose is speed on a fresh install: the toolchain step finds hydrogen-bootstrap already at the registry's latest and skips the multi-minute package walk.

Because nothing changed below the package layer, Hydrogen 1.0.437 and later never ask an install on v27 or newer to migrate (a v27 floor in the app, `NO_FORCED_MIGRATION_FROM`); the v28 pin only applies to fresh imports.

Also in this bake:
- xz-utils, gated in smoke (adom-wiki unpacks .tar.xz releases; a v27 install died on it).
- The permissions smoke gate checks what today's posture composer emits.
- The two Satoshi font files that adom/adom-wiki-hero-image started shipping are stripped (Fontshare EULA; the license gate still runs). Filed on that package as adom/adom-wiki-hero-image#1.
- The retired hd-golden-image skill is no longer a spot-check.

Baked 2026-09-18 on AdomLapper with hd-wsl2-image `image/bake-in-distro.sh` (GOLDEN_VERSION=v28-full, profile full). Skills deployed: 228. Claude Code 2.1.276, codex-cli 0.154.0-alpha.6.2, adom-cli 0.7.9, adom-vscode 1.1.92.
