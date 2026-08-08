---
name: hydrogen-who-am-i
description: How to answer "who am I and what can I do here?" — the auto-question HD's welcome step injects on first launch. Tells Claude what data sources to pull (Adom session token, adom-cli user/repo/container queries), the Linux-username-vs-Adom-username distinction (everyone is `adom` inside the container), and the template answer that names the user, shows their resources, and explains what HD + the Adom ecosystem can do for them. READ this skill when answering "who am i", "what can i do here", or "what is this environment". Trigger words — who am i, what can I do here, who is this user, welcome question, first AI question, introduce yourself, what is HD, what can hydrogen desktop do, user identity, user introspection, my profile in HD, my repos, my containers, linux username vs adom username, adom username container.
---

# HD Who Am I — answer the welcome-step prompt coherently

When HD finishes setup (the final setup step, `welcome`), it auto-injects this prompt into your Claude Code chat:

> **who am i and what can i do here**

Your job is to answer that prompt with a warm, accurate, **personalized** intro that confirms identity, surfaces resources, explains the environment, and points at what's possible. This skill tells you exactly where to get the data and how to phrase the answer.

## Data sources

Run these first (they're all fast — under 5s total):

| Field | Command | Notes |
|-------|---------|-------|
| Name + email + Adom username | `adom-cli carbon user get` | Returns `{name, formatted_name, email, ...}`. Adom username = the `name` field. |
| Repo count | `adom-cli carbon user repos --format json \| jq length` | Or count lines without jq |
| Cloud containers | `adom-cli carbon containers list --format json \| jq length` | Number of cloud-hosted Adom containers under this user |
| Workspace hostname | `hostname` | The workspace hostname (varies by runtime) |
| OS | `cat /etc/os-release \| grep PRETTY_NAME` | Always Ubuntu 24.04 |

If `adom-cli carbon user get` fails with no session token, the user isn't authenticated. In that case answer: "I don't see an Adom session — please log in via the HD login page first."

## The Linux-username-vs-Adom-username quirk (always mention this)

Every user's Linux username inside the HD workspace is **`adom`** — not their Adom username. This is intentional (consistency across all Adom workspaces makes filesystem paths, scripts, and skill examples portable). The user's Adom identity is John, Jane, etc.; their shell prompt just always says `adom@<workspace-hostname>`.

Mention this in the welcome answer so they don't get confused when their `whoami` says `adom`.

## What HD + the Adom ecosystem can do (the capabilities pitch)

Tell them they have access to a full electronics prototyping ecosystem. Specifically:

- **Build PCBs** — InstaPCB workflow with tscircuit, KiCad, our autorouter
- **Build apps** — wiki webview apps via the app-creator skill
- **Build CLIs** — automate workflows from the terminal
- **3D viewers** — full 3D component / STEP / GLB viewing in HD (via adom-step / adom-tsci panels)
- **Open KiCad or Fusion 360** on their Windows machine — HD bridges to the local apps
- **File transfer** — send/receive files between container and their Windows desktop (`adom-desktop send_files` / `pull_file`)
- **Talk to their cloud containers** — adom-cli reaches Adom-cloud-hosted containers under their account
- **Main AI dev environment** — HD is designed as the primary AI-powered dev surface for hardware + software

## Answer template

Adapt this to whatever the user's data is. Don't bullet-dump everything — write it as a warm welcome paragraph followed by capabilities. Use markdown.

```markdown
You're **{user.formatted_name}**, signed in to Adom as **{user.name}** ({user.email}). You're running in **Hydrogen Desktop**, Adom's local AI dev environment, on your Windows machine. The workspace itself is Ubuntu 24.04 with code-server, the `claude` CLI, and the full Adom skill ecosystem (gallia + HD skills) already loaded.

A few quick orientation notes:
- Your **Linux username here is `adom`** (not `{user.name}`) — that's intentional, every Adom workspace uses `adom` for consistency. Your Adom identity (`{user.name}`) is what shows up across the Adom ecosystem.
- You have **{N} repos** and **{M} cloud containers** under your Adom account.

Here's what we can do together in HD:

**Electronics & hardware**
- Build PCBs end-to-end (tscircuit → KiCad → Adom's autorouter → InstaPCB fab)
- Open KiCad or Fusion 360 on your Windows machine directly from here
- Browse parts (DigiKey, Mouser, JLCPCB) with live pricing + Adom-internal inventory
- Generate KiCad symbols, footprints, and 3D models from datasheets

**Apps & automation**
- Build webview apps for viewing symbols, footprints, 3D chips, boards, layouts, schematics, oscilloscopes, etc.
- Write CLI tools to automate hardware workflows
- View 3D STEP/GLB files in a Fusion-360-feel viewer

**Talk to your stuff**
- Reach your cloud Adom containers from here
- Send and pull files between this workspace and your Windows desktop
- Drive Chrome via Puppeteer for browser automation
- Take screenshots, record videos of your screen

Ask me to do any of those, or just ask "what's the best way to start a new PCB project?" if you want a guided tour.
```

## How to deliver the answer

- **Don't just bullet-dump every capability** — group them, lead with the personalized intro, end with an invitation.
- **Pull real numbers** from `adom-cli` — generic "you have some repos" feels worse than "you have 4 repos."
- **Don't list internal jargon** — say "Adom's autorouter", not "the gallia/autorouter/v2 skill".
- **Mention the Linux username quirk early** — it WILL confuse users on first `whoami`.
- **If a data fetch fails** (e.g. adom-cli not yet configured), gracefully say "I can't read your Adom session right now, but here's what HD can do once you're signed in" and pivot to capabilities only.

## Related skills

- [hydrogen-adom-auth](../hydrogen-adom-auth/SKILL.md) — the session token that gives `adom-cli` its identity
- [hydrogen-claude-auth](../hydrogen-claude-auth/SKILL.md) — Claude Code's own auth (separate)
- [hd-skill-catalog](../hd-skill-catalog/SKILL.md) — the full list of public hd-* skills your AI has access to
- `hydrogen-container` — the exact Ubuntu image / arch / pre-installed tools you'll mention
- [hydrogen-bridges](../hydrogen-bridges/SKILL.md) — KiCad / Fusion / Puppeteer bridge capabilities to mention
