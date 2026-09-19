#!/usr/bin/env bash
# One command for the weekly golden image (John 2026-09-18): "each week we'll build new
# versions of the golden-image to cache the latest adom-wiki pkg update". Runs from the cloud
# container against the laptop through adom-bridge (WSL2-native, the only supported bake).
#
#   bash scripts/bake-weekly.sh v29-full [--target AdomLapper]
#
# What it does, in order (every step is the one this repo's skill documents; nothing new):
#   1. stages image/{bake-in-distro.sh,bootstrap.sh,init-host-internal.sh,wsl.conf} to
#      C:\tmp\ctx on the laptop through the workspace's /mnt/c (hashes checked);
#   2. imports a fresh throwaway `golden-build` distro from C:\tmp\ubuntu-base.tar.gz;
#   3. runs the bake in the bridge's HELD session (wsl_exec_async) so /tmp survives and the
#      distro cannot stop mid-bake; polls until it exits; requires SMOKE-OK;
#   4. exports, gzips (-9) and hashes in the workspace; releases both assets on
#      adom-inc/hd-wsl2-image with gh ON THE LAPTOP (the upload exceeds the relay timeout, so
#      it is detached and polled); verifies the public download (200, size, sha, gzip magic);
#   5. prints the three values Hydrogen's pin needs (url, sha256, version) and the bytes.
#
# The floor: Hydrogen never asks an install on v27 or later to migrate (NO_FORCED_MIGRATION_FROM
# in hydrogen-desktop wsl.rs), so a weekly image is a speed-up for fresh installs, never an
# upgrade for anyone. Pin it in hydrogen-desktop with scripts/pin-golden.sh.
set -euo pipefail
VER="${1:?usage: bake-weekly.sh vN-full [--target <box>]}"; shift || true
TARGET="AdomLapper"; while [ $# -gt 0 ]; do case "$1" in --target) TARGET="$2"; shift 2;; *) shift;; esac; done
HERE="$(cd "$(dirname "$0")/.." && pwd)"
log(){ printf '\033[36m[bake-weekly]\033[0m %s\n' "$*"; }
die(){ printf '\033[31m[bake-weekly] %s\033[0m\n' "$*" >&2; exit 1; }
AB="adom-bridge --ai-thread bake-weekly --target $TARGET"
# hd_api / wsx as in hydrogen-desktop's demo lib: run a command inside the box's Adom-Workspace.
wsx(){ local C=$1 TO=${2:-120}; $AB hd_api "$(python3 -c 'import json,sys;print(json.dumps({"method":"POST","path":"/workspace/exec","timeoutSeconds":int(sys.argv[2])+15,"body":{"command":sys.argv[1],"timeoutSec":int(sys.argv[2])}}))' "$C" "$TO")" | python3 -c "
import sys,json
raw=sys.stdin.read()
try: d=json.loads(raw[raw.index('{'):]); b=d.get('body') if 'body' in d else d; print((b.get('stdout') or '').rstrip())
except Exception: print('WSX-RAW', raw[:200])"; }
ps(){ local why=$1 script=$2; $AB run_script "$(python3 -c 'import json,sys,base64;print(json.dumps({"scriptB64":base64.b64encode(sys.argv[1].encode("utf-16-le")).decode(),"interpreter":"powershell","shell":"powershell","reason":sys.argv[2],"timeoutSeconds":600}))' "$script" "$why")" 2>&1; }

log "1/5 staging the bake context to C:\\tmp\\ctx on $TARGET"
for f in bake-in-distro.sh bootstrap.sh init-host-internal.sh wsl.conf; do
  b64=$(base64 -w0 "$HERE/image/$f"); n=${#b64}; i=0
  wsx "mkdir -p /mnt/c/tmp/ctx && : > /mnt/c/tmp/ctx/$f.b64" 30 >/dev/null
  while [ $i -lt $n ]; do wsx "printf %s '${b64:$i:40000}' >> /mnt/c/tmp/ctx/$f.b64" 60 >/dev/null; i=$((i+40000)); done
  got=$(wsx "base64 -d /mnt/c/tmp/ctx/$f.b64 > /mnt/c/tmp/ctx/$f && rm /mnt/c/tmp/ctx/$f.b64 && md5sum /mnt/c/tmp/ctx/$f | cut -c1-32" 60 | tail -1)
  [ "$got" = "$(md5sum "$HERE/image/$f" | cut -c1-32)" ] || die "$f did not stage intact"
done

log "2/5 fresh throwaway distro golden-build"
ps "fresh throwaway WSL distro for the $VER golden image bake" "wsl --terminate golden-build 2>&1 | Out-Null; wsl --unregister golden-build 2>&1 | Out-Null; Remove-Item -Recurse -Force C:\\tmp\\golden-build -ErrorAction SilentlyContinue; New-Item -ItemType Directory -Force C:\\tmp\\golden-build | Out-Null; wsl --import golden-build C:\\tmp\\golden-build C:\\tmp\\ubuntu-base.tar.gz --version 2 2>&1 | Out-Null; 'imported'" | grep -q imported || die "import failed"

log "3/5 baking $VER in the bridge's held session"
B64=$(printf '%s' "export GOLDEN_VERSION=$VER GOLDEN_PROFILE=full; mkdir -p /tmp/ctx; cp /mnt/c/tmp/ctx/bake-in-distro.sh /mnt/c/tmp/ctx/bootstrap.sh /mnt/c/tmp/ctx/init-host-internal.sh /mnt/c/tmp/ctx/wsl.conf /tmp/ctx/; bash /tmp/ctx/bake-in-distro.sh" | base64 -w0)
JOB=$($AB wsl_exec_async "{\"distro\":\"golden-build\",\"user\":\"root\",\"scriptB64\":\"$B64\",\"reason\":\"Baking the $VER Hydrogen golden image in a throwaway WSL distro\"}" | grep -o '"jobId": *"[^"]*"' | cut -d'"' -f4)
[ -n "$JOB" ] || die "the bake job did not start"
log "job $JOB; polling every minute"
for i in $(seq 1 90); do
  sleep 60
  st=$($AB wsl_job_status "{\"jobId\":\"$JOB\"}")
  running=$(echo "$st" | python3 -c "import sys,json; raw=sys.stdin.read(); d=json.loads(raw[raw.index('{'):]); print(d.get('running')); print(d.get('exitCode')); print((d.get('outputTail') or '').split(chr(10))[-2][:100])")
  log "$(echo "$running" | tail -1)"
  echo "$running" | head -1 | grep -q False && break
done
echo "$st" | grep -q "SMOKE-OK" || die "no SMOKE-OK: read the job output (wsl_job_status $JOB, outputPath) and fix the bake"
[ "$(echo "$running" | sed -n 2p)" = "0" ] || die "bake exited non-zero"

log "4/5 export, gzip -9, sha256, release"
ps "export the baked $VER distro" "wsl --terminate golden-build 2>&1 | Out-Null; Remove-Item C:\\tmp\\adom-golden-$VER.tar -ErrorAction SilentlyContinue; wsl --export golden-build C:\\tmp\\adom-golden-$VER.tar 2>&1 | Out-Null; (Get-Item C:\\tmp\\adom-golden-$VER.tar).Length" | tail -1
wsx "rm -f /mnt/c/tmp/adom-golden-$VER.tar.gz /mnt/c/tmp/gz.done; (setsid -f nohup bash -c 'cd /mnt/c/tmp && gzip -9 -c adom-golden-$VER.tar > adom-golden-$VER.tar.gz && sha256sum adom-golden-$VER.tar.gz | tee adom-golden-$VER.tar.gz.sha256 > gz.done' >/dev/null 2>&1 </dev/null); echo started" 60 >/dev/null
for i in $(seq 1 60); do sleep 30; wsx "test -s /mnt/c/tmp/gz.done && echo DONE" 30 | grep -q DONE && break; done
SHA=$(wsx "cut -d' ' -f1 /mnt/c/tmp/gz.done" 30 | tail -1); BYTES=$(wsx "stat -c %s /mnt/c/tmp/adom-golden-$VER.tar.gz" 30 | tail -1)
[ ${#SHA} -eq 64 ] || die "no sha256 (gzip still running or failed)"
NOTES="$HERE/releases/$VER.md"; [ -f "$NOTES" ] || { mkdir -p "$HERE/releases"; printf '%s: weekly golden image, the current packages baked in. No base-layer change; installs on v27 or later are never asked to migrate.\n' "$VER" > "$NOTES"; }
gh release view "$VER" --repo adom-inc/hd-wsl2-image >/dev/null 2>&1 || gh release create "$VER" --repo adom-inc/hd-wsl2-image --title "$VER" --notes-file "$NOTES"
ps "upload the $VER image to the GitHub release (detached; exceeds the relay timeout)" "Start-Process -WindowStyle Hidden -FilePath gh -ArgumentList 'release','upload','$VER','C:\\tmp\\adom-golden-$VER.tar.gz','C:\\tmp\\adom-golden-$VER.tar.gz.sha256','--repo','adom-inc/hd-wsl2-image','--clobber' -RedirectStandardOutput C:\\tmp\\gh-upload.log -RedirectStandardError C:\\tmp\\gh-upload.err; 'started'" >/dev/null
URL="https://github.com/adom-inc/hd-wsl2-image/releases/download/$VER/adom-golden-$VER.tar.gz"
for i in $(seq 1 60); do sleep 30; c=$(curl -sIL -o /dev/null -w '%{http_code} %{size_download}' "$URL" 2>/dev/null); l=$(curl -sIL "$URL" | grep -i '^content-length' | tail -1 | tr -dc '0-9'); [ "$l" = "$BYTES" ] && break; done
[ "$l" = "$BYTES" ] || die "public download does not match ($l vs $BYTES bytes)"
[ "$(curl -sL "$URL.sha256" | cut -d' ' -f1)" = "$SHA" ] || die "sidecar sha mismatch"
[ "$(curl -sL --range 0-1 "$URL" | xxd -p)" = "1f8b" ] || die "not gzip"

log "5/5 $VER released and verified"
echo "TARBALL_URL=$URL"
echo "TARBALL_SHA256=$SHA"
echo "TARBALL_VERSION=$VER"
echo "BYTES=$BYTES"
echo "next: cd hydrogen-desktop && bash scripts/pin-golden.sh $VER $SHA $BYTES"
