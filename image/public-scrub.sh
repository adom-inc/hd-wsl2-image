#!/usr/bin/env bash
# public-scrub.sh — run as root inside the rootfs after install.mjs.
#
# This image ships to the public. Strip everything that phones home to
# private infra or assumes GitHub auth:
#   - the gallia stale-detector hook (UserPromptSubmit → check-updates.sh):
#     a 30-min `git fetch` against the private gallia repo — pointless
#     without .git in the snapshot and wrong for non-employee machines.
#     Updates ship as new image versions instead.
#   - bake-time update stamps under ~/.adom
#
# Keep idempotent; both scripts/build-rootfs.sh (chroot) and
# image/Dockerfile (CI) run this same file.

set -euo pipefail

S=/home/adom/.claude/settings.json
if [[ -f "$S" ]]; then
    jq '(.hooks.UserPromptSubmit // []) |= map(
            select(((.hooks // []) | any(.command // "" | contains("check-updates.sh"))) | not))
        | if ((.hooks.UserPromptSubmit // []) | length) == 0 then del(.hooks.UserPromptSubmit) else . end' \
        "$S" > "$S.tmp"
    mv "$S.tmp" "$S"
    chown 1001:1001 "$S"
fi

rm -f /home/adom/.adom/last-update-check \
      /home/adom/.adom/last-wiki-check \
      /home/adom/.adom/last-wiki-fetch-fail
