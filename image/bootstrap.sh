#!/usr/bin/env bash
# bootstrap.sh — golden-image edition.
#
# In the thin-tarball design this script INSTALLED the workspace (Phase A:
# apt + code-server, Phase B: wiki install.mjs). The golden rootfs bakes all
# of Phase A and the Adom CLI binaries at image-build time, so this script
# is demoted to a best-effort UPDATER: refresh CLIs/skills from the wiki
# when an installer script is published there.
#
# It must NEVER fail HD setup — the image is self-sufficient without it.
# Always exits 0.
#
# Note: as of 2026-06-11 install.mjs is NOT published at the wiki static
# path (gallia ships it only inside the private repo). Until that changes,
# this script logs a skip and exits — which is correct behavior, not a bug.

set -u

LOCK=/tmp/adom-bootstrap.lock
exec 9>"${LOCK}"
if ! flock -n 9; then
    echo "bootstrap.sh: another instance is running, exiting" >&2
    exit 0
fi

STATEDIR=/var/lib/adom-bootstrap
sudo mkdir -p "${STATEDIR}"

INSTALL_MJS_URL="${ADOM_INSTALL_MJS_URL:-https://wiki-ufypy5dpx93o.adom.cloud/static/install.mjs}"
TMP="$(mktemp)"
trap 'rm -f "${TMP}"' EXIT

if curl -fsSL --retry 3 --retry-delay 2 "${INSTALL_MJS_URL}" -o "${TMP}"; then
    echo "bootstrap.sh: running updater (install.mjs)"
    if node "${TMP}"; then
        echo "bootstrap.sh: ✓ update complete"
    else
        echo "bootstrap.sh: ⚠ install.mjs exited nonzero — updater is best-effort, continuing" >&2
    fi
else
    echo "bootstrap.sh: install.mjs not published at ${INSTALL_MJS_URL} — nothing to update" >&2
fi

date -Iseconds | sudo tee "${STATEDIR}/last-run" >/dev/null
exit 0
