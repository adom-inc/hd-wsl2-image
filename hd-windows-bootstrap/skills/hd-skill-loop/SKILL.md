---
name: hd-skill-loop
description: >
  The maintainer loop for making HD's own hd-* skills perfect: when a skill is
  wrong, stale, or confusing, verify the truth against the RUNNING HD, fix the
  skill live in the workspace, then write the corrected file back into the core
  hydrogen-desktop repo so the next golden-image bake ships it. These skills are
  the ONLY thing the in-workspace AI knows about HD — a wrong one confuses every
  Adom user. For Adom devs improving HD. Trigger words — this skill is wrong,
  stale skill, fix the hd skill, update a skill, the AI got confused by a skill,
  improve hd skills, skill is inaccurate, debug a skill, skill loop, write skill
  back to repo, bake skills, golden image skills, skill feedback loop, perfect
  the skills, skill says X but it actually does Y.
---

# HD Skill Loop — verify → fix live → write back to the repo → bake

HD's `hd-*` skills are baked into the WSL2 golden image and are the **only** way
the in-workspace AI knows anything about HD. So a wrong skill silently breaks
every user's AI (it curls a dead hostname, hunts a command that doesn't exist,
claims it needs a tool that isn't installed…). This skill is the loop to find
those and make them perfect *before* the next bake.

## Cardinal rule: TEST, don't assert

Never write a skill claim from memory, old skill text, or docs — **verify it
against the running system first.** Run the command. Read the live env. Read the
code. Observe the real return shape. If you can't test a claim, don't state it as
fact. (Most skill bugs are confident, untested assertions.)

## Where skills live — two copies

| Copy | Path | Role |
|---|---|---|
| **Live (ephemeral)** | `~/.claude/skills/<name>/SKILL.md` (flat) | What the running AI reads NOW. Editing here fixes THIS session and lets you test — but it's wiped on virgin reset / replaced by the next image. |
| **Canonical (baked)** | repo `skills/public-facing/{shared,wsl2,docker}/<name>/SKILL.md` | What the golden image is built from. On the laptop the repo is auto-mounted at `/mnt/c/Github/hydrogen-desktop/...` (the same tree the install step reads). The bake pulls from `origin`. |

A fix isn't done until it's in the **canonical** copy and pushed.

## The loop

### 1. Reproduce / notice
A skill made the AI do the wrong thing. Name the skill and the exact wrong claim.

### 2. Get ground truth from the LIVE system
- **Run the real command** and read its `--help` and actual output:
  `adom-cli hydrogen <verb> --help` → then run it → note the EXACT return shape
  (e.g. HD's `screenshot` returns a `dataUrl` inline when `uploadFailed:true`,
  not a saved path).
- **Read the live env**, never hardcode: `cat ~/.adom/hd-control-url` (the real
  control URL — `http://127.0.0.1:<dynamic-port>`, NOT `host.docker.internal`,
  NOT a fixed 47084), `env | grep ADOM_`, `adom-cli hydrogen probe`.
- **Read the HD source** for the endpoint/behavior (the repo checkout).
- **Not inside HD?** `adom-cli` is the SAME binary in web Hydrogen — test there.
  Or reach the user's running HD through Adom Desktop:
  ```bash
  adom-desktop ping && adom-desktop status        # confirm AD is on the right host
  # run anything inside the HD distro:
  adom-desktop wsl_exec '{"distro":"Adom-Workspace","user":"adom","scriptB64":"<base64 of your script>"}'
  ```

### 3. Fix it live + re-test
Edit `~/.claude/skills/<name>/SKILL.md` to match what you verified. Re-read it,
then **re-run the failing action** to confirm the fix actually works.

### 3b. GRADE the fix (don't just eyeball it)
Re-running the action by hand proves little. If you're an Adom maintainer, run the
**`hd-skill-test`** grader (dev-internal): add/update a case encoding the *correct*
behavior plus the anti-pattern that was the bug (e.g. `must_not_appear:
host\.docker\.internal`), then grade against the live (fixed) skill via a fresh
headless `claude` session. PASS means the fix actually changed model behavior, not
just the prose. Gate the write-back/commit on a green battery so fixing skill A
can't silently regress skill B. (See the `hd-skill-test` skill.)

### 4. Pick the bucket
Runtime-neutral → `shared/`; runtime-specific → `wsl2/` (+ keep `docker/`
pristine). `name:` must equal the dir; skills install flat. (See the dev skill
`hd-skills-structure` for the full rules.)

### 5. Write the corrected file back to the repo
Copy the same corrected SKILL.md into the canonical bucket:
```bash
cp ~/.claude/skills/<name>/SKILL.md \
   /mnt/c/Github/hydrogen-desktop/skills/public-facing/<bucket>/<name>/SKILL.md
```
If you added / renamed / removed a skill, also update the indexes
`hd-overview` and `hd-skill-catalog` (both in `shared/`).

### 6. Commit + push so the next bake ships it
From the laptop checkout (it has git + credentials), via the relay:
```bash
adom-desktop run_script '{"interpreter":"powershell","scriptB64":"<base64 of:
  cd C:\Github\hydrogen-desktop; git add skills; git commit -m \"skills: fix <name> (verified vs live HD)\"; git push>"}'
```
The next **golden-image bake** (`golden-image-bake`) pulls `origin` and bakes the
corrected skills into the image, so the fix reaches every user's next HD.

## Validation checklist before you commit a skill
- [ ] Every command in the skill was actually RUN and produced the documented output.
- [ ] No `host.docker.internal` anywhere — HD reaches the host at `127.0.0.1` /
      `$(cat ~/.adom/hd-control-url)` (WSL2 mirrored networking; ports are dynamic).
- [ ] No invented CLI verbs — each confirmed with `--help`.
- [ ] No tool assumed present that isn't in the golden image (ImageMagick `convert`,
      Pillow, `jq`…) — test it in the distro before relying on it.
- [ ] Step counts / endpoint paths / ports match CURRENT code (they drift fast).
- [ ] Cross-links use sibling skill names that resolve flat at deploy.
- [ ] `name:` matches the directory.

## Why this matters
The skills ARE HD's self-knowledge for the AI. Ship them wrong and every Adom
user's AI is confidently wrong with them. Treat "the skill is inaccurate" as a
product bug and run this loop until the validation checklist is clean.

## Related skills
- `hd-skill-test` (dev-internal) — the automated GRADE step (step 3b): headless-`claude` battery that asserts tool choices / forbidden patterns
- `hd-skills-structure` (dev-internal) — bucket rules, naming, the deploy/bake mechanism
- [hd-golden-image](../hd-golden-image/SKILL.md) — the baked-image model these skills ship in
- `golden-image-bake` — the tooling that rebuilds the image from the repo
- [hd-self-screenshot](../hd-self-screenshot/SKILL.md) — a skill fixed via this loop (the `adom-cli hydrogen screenshot` / `dataUrl` truth)
- [hd-desktop-sse](../hd-desktop-sse/SKILL.md) — the adom-cli → HD-proxy → SSE interception model you test against
