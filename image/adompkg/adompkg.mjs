#!/usr/bin/env node
// Suppress EPIPE stack trace when piping to head/etc.
process.stdout.on("error", err => { if (err.code === "EPIPE") process.exit(0); throw err; });
process.stderr.on("error", err => { if (err.code === "EPIPE") process.exit(0); throw err; });
/**
 * adompkg v2 — npm-style package manager for the Adom Wiki.
 *
 * Layout (npm-style, all visible inside the user's default project folder):
 *
 *   ~/project/adom_modules/         extracted package contents
 *     <slug>/                       package files
 *     .installed.json               registry
 *     .lock.json                    last resolved tree
 *     .cache/                       downloaded tarballs (offline re-install)
 *
 *   ~/.local/bin/adompkg            CLI itself (hidden, system-side)
 *   ~/.claude/skills/<slug>/        skill files (target of install.sh)
 *   /usr/local/bin/<binary>         system binaries
 *
 * Configure via ADOMPKG_PREFIX (default ~/project/adom_modules).
 *
 * Config env:
 *   ADOMPKG_REGISTRY  base URL of the wiki
 *   ADOMPKG_TOKEN     bearer token for publish (Carbon API key works)
 *   ADOMPKG_PREFIX    modules location (default ~/project/adom_modules)
 *   ADOMPKG_ORG       default --org slug
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import readline from "node:readline";
import { execFileSync, spawnSync } from "node:child_process";

const VERSION = "2.18.0";
const REGISTRY = (process.env.ADOMPKG_REGISTRY || "https://wiki.adom.inc").replace(/\/$/, "");
const HOME = os.homedir();
const PREFIX = process.env.ADOMPKG_PREFIX || path.join(HOME, "project", "adom_modules");
const INSTALLED_FILE = path.join(PREFIX, ".installed.json");
const LOCK_FILE = path.join(PREFIX, ".lock.json");
const CACHE_DIR = path.join(PREFIX, ".cache");
const AUTH_DIR = path.join(HOME, ".adom");
const CARBON_URL = process.env.CARBON_URL || "https://carbon.adom.inc";
const DEFAULT_ORG = process.env.ADOMPKG_ORG || null;

// Standard exit codes:
//   0 = success
//   1 = runtime error (network, server, integrity, etc.)
//   2 = user-facing input error (bad usage, missing arg, validation)
const EXIT_OK = 0;
const EXIT_ERR = 1;
const EXIT_USAGE = 2;

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const YEL = "\x1b[33m";
const GRN = "\x1b[32m";
const RESET = "\x1b[0m";

function bold(s) { return process.stdout.isTTY ? `${BOLD}${s}${RESET}` : s; }
function dim(s) { return process.stdout.isTTY ? `${DIM}${s}${RESET}` : s; }
function yel(s) { return process.stdout.isTTY ? `${YEL}${s}${RESET}` : s; }
function red(s) { return process.stderr.isTTY ? `${RED}${s}${RESET}` : s; }
function grn(s) { return process.stdout.isTTY ? `${GRN}${s}${RESET}` : s; }

function ensurePrefix() {
  if (!fs.existsSync(PREFIX)) fs.mkdirSync(PREFIX, { recursive: true });
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function loadInstalled() {
  if (!fs.existsSync(INSTALLED_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(INSTALLED_FILE, "utf8")); } catch { return {}; }
}

function saveInstalled(obj) {
  ensurePrefix();
  fs.writeFileSync(INSTALLED_FILE, JSON.stringify(obj, null, 2));
}

function loadLock() {
  if (!fs.existsSync(LOCK_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(LOCK_FILE, "utf8")); } catch { return null; }
}

function saveLock(obj) {
  ensurePrefix();
  fs.writeFileSync(LOCK_FILE, JSON.stringify(obj, null, 2));
}

function die(msg, code = EXIT_ERR) {
  process.stderr.write(`adompkg: ${msg}\n`);
  process.exit(code);
}

function usage(msg) {
  die(msg, EXIT_USAGE);
}

// ------------------------------------------------------------
// Auth: token resolution and on-disk credential store.
// Priority: ADOMPKG_TOKEN env > /var/run/adom/api-key > none.
// Never modify lib/auth.js — this is purely client-side credential storage.
// ------------------------------------------------------------



function getToken() {
  // Priority:
  //   1. ADOMPKG_TOKEN env (for explicit override)
  //   2. /var/run/adom/api-key (every Adom container has this Carbon token)
  if (process.env.ADOMPKG_TOKEN) return process.env.ADOMPKG_TOKEN;
  try {
    const containerKey = fs.readFileSync("/var/run/adom/api-key", "utf8").trim();
    if (containerKey) return containerKey;
  } catch {}
  return null;
}

// ------------------------------------------------------------
// HTTP helpers
// ------------------------------------------------------------

// Only send the Carbon bearer token to registries we trust. Otherwise a
// hijacked ADOMPKG_REGISTRY (e.g. set to https://evil by a malicious install.sh)
// would exfiltrate the live token on the next request. Trust = *.adom.inc,
// localhost (dev/tests), or an explicit ADOMPKG_TRUSTED_REGISTRY_HOSTS allowlist.
function registryHost() {
  try { return new URL(REGISTRY).hostname.toLowerCase(); } catch { return ""; }
}
function isTrustedRegistry() {
  const host = registryHost();
  if (!host) return false;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  if (host === "adom.inc" || host.endsWith(".adom.inc")) return true;
  return (process.env.ADOMPKG_TRUSTED_REGISTRY_HOSTS || "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean).includes(host);
}

let _warnedUntrusted = false;
function authHeaders(extra = {}) {
  const h = { ...extra };
  if (isTrustedRegistry()) {
    const t = getToken();
    if (t) h["Authorization"] = `Bearer ${t}`;
    if (process.env.ADOMPKG_COOKIE) h["Cookie"] = process.env.ADOMPKG_COOKIE;
  } else if (!_warnedUntrusted) {
    _warnedUntrusted = true;
    process.stderr.write(`${yel("warning:")} registry host '${registryHost()}' is not a trusted Adom host — withholding your auth token. Set ADOMPKG_TRUSTED_REGISTRY_HOSTS=${registryHost()} to allow it.\n`);
  }
  return h;
}

function describeFetchError(err, url) {
  const code = err && (err.code || err.cause?.code);
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return `cannot reach registry at ${url} (DNS lookup failed). Check your internet connection.`;
  }
  if (code === "ECONNREFUSED") {
    return `connection refused to ${url}. The registry server may be down.`;
  }
  if (code === "ECONNRESET") {
    return `connection reset talking to ${url}. The registry may be restarting; try again in a moment.`;
  }
  if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT") {
    return `connection to ${url} timed out. Check your internet connection.`;
  }
  return err && err.message ? err.message : String(err);
}

async function httpJson(url, opts = {}) {
  const headers = authHeaders(opts.headers || {});
  let res;
  try {
    res = await fetch(url, { ...opts, headers });
  } catch (err) {
    const e = new Error(describeFetchError(err, url));
    e.network = true;
    throw e;
  }
  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { error: text }; }
  if (!res.ok) {
    const err = new Error(parsed?.error || `HTTP ${res.status} ${res.statusText}`);
    err.status = res.status;
    err.body = parsed;
    if (res.status === 429) {
      const retry = res.headers.get("retry-after");
      err.message = `rate limit exceeded${retry ? ` (retry after ${retry}s)` : ""}. Please slow down and try again.`;
    }
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      err.message = `registry is unavailable (HTTP ${res.status}). The server may be down or restarting.`;
    }
    throw err;
  }
  return parsed;
}

async function httpDownload(url, destPath) {
  let res;
  try {
    res = await fetch(url, { headers: authHeaders() });
  } catch (err) {
    const e = new Error(`failed to download ${url}: ${describeFetchError(err, url)}`);
    e.network = true;
    throw e;
  }
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status} ${res.statusText} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
  return { destPath, headers: res.headers };
}

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return "sha256-" + crypto.createHash("sha256").update(buf).digest("hex");
}

// --- Release signature verification (mirrors lib/signing.js on the server) ---

// The exact bytes the registry signs. Must match lib/signing.js verbatim.
function signingMessage(owner, slug, version, integrity) {
  return `adompkg-sig-v1\n${owner}/${slug}@${version}\n${integrity}`;
}

function verifySignature({ owner, slug, version, integrity, signature, publicKeyB64 }) {
  if (!signature || !publicKeyB64 || !integrity || !owner) return false;
  try {
    const pub = crypto.createPublicKey({ key: Buffer.from(publicKeyB64, "base64"), format: "der", type: "spki" });
    return crypto.verify(null, Buffer.from(signingMessage(owner, slug, version, integrity)), pub, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

// Fetch the registry's signing key and pin it on first use (TOFU). On a later
// install, a changed key id is treated as a pin violation. Returns
// { key_id, public_key } or null if the registry can't be reached.
const REGISTRY_KEY_PIN = path.join(CACHE_DIR, "registry-keys.json");
let _registryKey;
async function getRegistryKey() {
  if (_registryKey !== undefined) return _registryKey;
  let served = null;
  try {
    const res = await fetch(`${REGISTRY}/api/v1/signing-key`, { headers: authHeaders() });
    if (res.ok) served = await res.json();
  } catch { /* offline / old registry */ }

  let pins = {};
  try { pins = JSON.parse(fs.readFileSync(REGISTRY_KEY_PIN, "utf8")); } catch {}
  const pinned = pins[REGISTRY] || null;

  if (pinned && served && served.key_id !== pinned.key_id) {
    throw new Error(
      `registry signing key for ${REGISTRY} changed (pinned ${pinned.key_id}, now ${served.key_id}). ` +
      `If this is intentional, delete ${REGISTRY_KEY_PIN}; otherwise you may be under attack.`,
    );
  }
  if (!pinned && served && served.public_key) {
    pins[REGISTRY] = { key_id: served.key_id, public_key: served.public_key };
    try { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(REGISTRY_KEY_PIN, JSON.stringify(pins, null, 2)); } catch {}
  }
  _registryKey = pinned || served || null;
  return _registryKey;
}

// ------------------------------------------------------------
// Tarball extraction safety
//
// A published package is untrusted input. Before extracting we refuse any
// member or link that could write/point OUTSIDE the module dir — path
// traversal (`..`), absolute paths, home-relative (`~`), NUL injection, or a
// symlink/hardlink whose target escapes. Mirrors lib/packages.js so the client
// never relies on the registry having checked.
// ------------------------------------------------------------
function isUnsafeArchivePath(p) {
  if (!p) return false;
  const s = String(p);
  if (s.includes("\0")) return true;
  if (s.startsWith("/") || s.startsWith("~")) return true;
  return s.split("/").some(seg => seg === "..");
}

function assertSafeArchive(tgzPath) {
  let names = [];
  try {
    names = execFileSync("tar", ["tzf", tgzPath], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .split("\n").filter(Boolean);
  } catch (err) {
    throw new Error(`cannot inspect tarball ${tgzPath}: ${err.message}`);
  }
  const bad = [];
  for (const n of names) {
    if (isUnsafeArchivePath(n.replace(/^\.\//, ""))) bad.push(`member escapes package dir: ${n}`);
  }
  // Symlink / hardlink targets (verbose listing, 'l'/'h' typeflag lines).
  try {
    const verbose = execFileSync("tar", ["tzvf", tgzPath], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    for (const line of verbose.split("\n")) {
      const tf = line[0];
      if (tf !== "l" && tf !== "h") continue;
      const arrow = line.indexOf(" -> ");
      if (arrow === -1) continue;
      const target = line.slice(arrow + 4).trim();
      if (isUnsafeArchivePath(target)) bad.push(`${tf === "l" ? "symlink" : "hardlink"} target escapes package dir: ${target}`);
    }
  } catch { /* best-effort; name checks above still apply */ }
  if (bad.length > 0) {
    throw new Error(`refusing to install unsafe tarball (path traversal / escaping link):\n  ${bad.slice(0, 5).join("\n  ")}`);
  }
}

// ------------------------------------------------------------
// Script runner
// ------------------------------------------------------------

// A package can request its install/postinstall script run as root via
// needs_sudo. That's publisher-controlled, so don't run it under sudo silently:
// require explicit opt-in (--allow-sudo or ADOMPKG_ALLOW_SUDO=1). Otherwise a
// package could get unprompted root on any host with passwordless sudo.
function sudoAllowed() {
  return process.argv.includes("--allow-sudo") || process.env.ADOMPKG_ALLOW_SUDO === "1";
}

// npm-style: skip running package lifecycle scripts (install / postinstall)
// when --ignore-scripts (or ADOMPKG_IGNORE_SCRIPTS=1) is set.
function ignoreScripts() {
  return process.argv.includes("--ignore-scripts") || process.env.ADOMPKG_IGNORE_SCRIPTS === "1";
}

function runScript(scriptPath, cwd, needsSudo) {
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Script not found: ${scriptPath}`);
  }
  if (needsSudo && !sudoAllowed()) {
    throw new Error(
      `package wants to run its install script as root (needs_sudo). Re-run with --allow-sudo ` +
      `(or set ADOMPKG_ALLOW_SUDO=1) to permit this.`,
    );
  }
  fs.chmodSync(scriptPath, 0o755);
  const cmd = needsSudo ? "sudo" : "bash";
  const args = needsSudo ? ["bash", scriptPath] : [scriptPath];
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`Script exited with status ${result.status}: ${scriptPath}`);
  }
}

// ------------------------------------------------------------
// Resolve
// ------------------------------------------------------------

// Map Node's process.platform to a release platform. An explicit override
// (--platform) lets you resolve for another OS (e.g. preparing an install on a
// different host); otherwise we resolve for the current host.
function hostPlatform() {
  const p = process.platform;
  return p === "win32" ? "windows" : p === "darwin" ? "macos" : p === "linux" ? "linux" : "any";
}

async function resolveTree(packages, org, opts = {}) {
  const url = `${REGISTRY}/api/v1/packages/resolve`;
  const body = { packages, platform: opts.platform || hostPlatform() };
  if (org) body.org = org;
  if (opts.includeDev) body.includeDev = true;
  try {
    return await httpJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (err.body && err.body.missing) {
      const list = err.body.missing.join(", ");
      throw new Error(`package${err.body.missing.length === 1 ? "" : "s"} not found: ${list}. Try 'adompkg search <slug>' or check the spelling.`);
    }
    if (err.body && err.body.ambiguous) {
      throw new Error(err.body.error || err.message);
    }
    // edge case 4: private package access denied — surface the server message
    // (which tells the user to set ADOMPKG_TOKEN) instead of a bare 401.
    if (err.body && err.body.forbidden) {
      const m = err.body.error || err.message;
      throw new Error(`${m}. If this is a private org package, set ADOMPKG_TOKEN (or ensure the container API key is present) or pass --org <slug>.`);
    }
    // edge case 9: conflicting version constraints.
    if (err.body && err.body.conflicts) {
      throw new Error(err.body.error || err.message);
    }
    throw err;
  }
}

// ------------------------------------------------------------
// Install
// ------------------------------------------------------------

// Local module layout. A package is identified by its qualified name
// <owner>/<slug>, so the extracted contents live at PREFIX/<owner>/<slug>/.
// When the owner is unknown (a bare-slug reference — e.g. an old install
// record, or `adompkg link <slug>` against a manifest with no owner field),
// fall back to the flat PREFIX/<slug>/ layout for back-compat.
function moduleDirFor(owner, slug) {
  // Tolerate being called with a single qualified ref ("owner/slug") or a
  // single bare slug, in addition to (owner, slug).
  if (slug === undefined) {
    const ref = owner;
    if (typeof ref === "string" && ref.includes("/")) {
      const i = ref.indexOf("/");
      return path.join(PREFIX, ref.slice(0, i), ref.slice(i + 1));
    }
    return path.join(PREFIX, ref);
  }
  if (!owner) return path.join(PREFIX, slug);
  return path.join(PREFIX, owner, slug);
}

// Cache tarballs by qualified name so two owners' same-slug packages don't
// collide. Bare (owner-less) refs keep the flat <slug>-<version>.tgz name.
function cachedTarballPath(owner, slug, version) {
  if (version === undefined) {
    // Called as (slug, version) — bare/back-compat form.
    return path.join(CACHE_DIR, `${owner}-${slug}.tgz`);
  }
  if (!owner) return path.join(CACHE_DIR, `${slug}-${version}.tgz`);
  return path.join(CACHE_DIR, `${owner}__${slug}-${version}.tgz`);
}

// Verify a downloaded tarball's integrity and the registry's release signature
// BEFORE it is extracted or any install script runs. Fail-closed: throws (and
// deletes the bad cache file) on any failure, returns the verified content hash
// on success. Shared by the interactive install path (installOne) and the
// unattended lockfile-replay path (cmdCi) so CI gets the exact same guarantees.
//
//   - The trusted integrity hash is the resolver/lockfile value ONLY. A server
//     response header (X-Integrity) is recomputed from whatever bytes the server
//     chose to send, so trusting it makes the hash check tautological for a
//     malicious/mirrored registry. We never promote it to the trusted hash. (#4)
//   - The signature binds `owner`, so an owner-less package can't be verified at
//     all; treat it as unsigned and refuse unless --allow-unsigned rather than
//     silently skipping the authenticity check. (#4)
//   - An owned release with NO signature is refused too (unless --allow-unsigned).
//     Integrity-only proves the bytes match the resolver's hash, not that the
//     registry's key authorized this release — so a stripped signature must not
//     silently downgrade authenticity to "the server said so". Legacy unsigned
//     releases can still be installed explicitly with --allow-unsigned.
async function verifyTarball({ name, owner, slug, version, cacheTar, integrity, signature, signing_key_id, respHeaders }) {
  const allowUnsigned = process.argv.includes("--allow-unsigned") || process.env.ADOMPKG_ALLOW_UNSIGNED === "1";
  const localHash = sha256File(cacheTar);
  const rmCache = () => { try { fs.unlinkSync(cacheTar); } catch {} };
  const header = (k) => (respHeaders && typeof respHeaders.get === "function" ? respHeaders.get(k) : null);

  // Integrity: compare downloaded bytes against the TRUSTED resolver/lock hash.
  const expected = integrity || null;
  if (!expected) {
    if (!allowUnsigned) {
      rmCache();
      throw new Error(`refusing to install ${name}@${version}: no trusted integrity hash available (pass --allow-unsigned to override)`);
    }
    // --allow-unsigned: still catch a corrupt download against the (untrusted)
    // server hash hint, but make clear nothing is actually verified.
    const hint = header("x-integrity");
    if (hint && hint !== localHash) {
      rmCache();
      throw new Error(`download corrupt for ${name}@${version}: server hash ${hint}, got ${localHash}`);
    }
    process.stderr.write(`  ${yel("warning:")} no trusted integrity hash for ${name}@${version} — installing unverified (--allow-unsigned)\n`);
    return localHash;
  }
  if (expected !== localHash) {
    rmCache();
    throw new Error(`integrity check failed for ${name}@${version}: expected ${expected}, got ${localHash}`);
  }

  // Authenticity: an owner-less package cannot carry a verifiable signature.
  if (!owner) {
    if (!allowUnsigned) {
      rmCache();
      throw new Error(`cannot verify ${name}@${version}: package has no owner to bind a signature to (pass --allow-unsigned to override)`);
    }
    process.stderr.write(`  ${yel("warning:")} ${name}@${version} has no owner — signature not verifiable (--allow-unsigned)\n`);
    return localHash;
  }

  const sig = signature || header("x-signature") || null;
  if (sig) {
    let regKey;
    try { regKey = await getRegistryKey(); } catch (err) { rmCache(); throw err; }
    if (!regKey) {
      if (!allowUnsigned) { rmCache(); throw new Error(`cannot verify ${name}@${version}: registry signing key unavailable (pass --allow-unsigned to override)`); }
    } else {
      const servedKeyId = signing_key_id || header("x-signing-key-id") || null;
      if (servedKeyId && regKey.key_id && servedKeyId !== regKey.key_id) {
        rmCache();
        throw new Error(`signing-key mismatch for ${name}@${version}: signed by ${servedKeyId}, pinned key is ${regKey.key_id}`);
      }
      if (!verifySignature({ owner, slug, version, integrity: expected, signature: sig, publicKeyB64: regKey.public_key })) {
        rmCache();
        throw new Error(`signature verification FAILED for ${name}@${version} — refusing to install`);
      }
      process.stdout.write(`  ${grn("verified")} signature (key ${regKey.key_id})\n`);
    }
  } else if (!allowUnsigned) {
    rmCache();
    throw new Error(`refusing to install ${name}@${version}: release is not signed (pass --allow-unsigned to override)`);
  } else {
    process.stderr.write(`  ${yel("warning:")} ${name}@${version} is not signed — installing unverified (--allow-unsigned)\n`);
  }
  return localHash;
}

async function installOne(pkg, installed, lockEntries) {
  ensurePrefix();
  const { slug, version, type, needs_sudo, tarball, scripts, dependencies, integrity, signature, signing_key_id, deprecated, org_id, org_name, dev, optional } = pkg;
  const owner = pkg.owner || null;
  // Qualified name is the install-registry key. Resolved entries always carry
  // `name` (= "<owner>/<slug>"); fall back to slug for any legacy caller.
  const name = pkg.name || (owner ? `${owner}/${slug}` : slug);
  const moduleDir = moduleDirFor(owner, slug);
  const cacheTar = cachedTarballPath(owner, slug, version);

  if (installed[name] && installed[name].version === version) {
    process.stdout.write(`  already installed: ${name}@${version}\n`);
    return;
  }

  if (deprecated) {
    process.stderr.write(`${yel("WARNING:")} ${name}@${version} is deprecated: ${deprecated}\n`);
  }

  process.stdout.write(`  downloading ${name}@${version}...\n`);
  const { headers: respHeaders } = await httpDownload(`${REGISTRY}${tarball}`, cacheTar);

  // Verify the downloaded bytes + registry signature. Fail-closed (throws on
  // missing/mismatched integrity or bad signature) unless --allow-unsigned.
  const localHash = await verifyTarball({
    name, owner, slug, version, cacheTar, respHeaders,
    integrity, signature, signing_key_id,
  });

  // Security: before extracting an untrusted tarball, refuse any member or
  // link that would escape the module dir (path traversal / absolute path /
  // escaping symlink). The registry checks this on publish too, but a client
  // must never trust that — a tampered cache or compromised mirror could
  // deliver a malicious tarball.
  assertSafeArchive(cacheTar);

  if (fs.existsSync(moduleDir)) {
    fs.rmSync(moduleDir, { recursive: true, force: true });
  }
  // recursive: true creates the intermediate <owner>/ directory too.
  fs.mkdirSync(moduleDir, { recursive: true });
  try {
    execFileSync("tar", ["xzf", cacheTar, "-C", moduleDir], { stdio: "inherit" });
  } catch (err) {
    // edge case 5/15: don't leave a half-extracted module dir behind.
    try { fs.rmSync(moduleDir, { recursive: true, force: true }); } catch {}
    throw new Error(`Failed to extract tarball: ${err.message}`);
  }

  const installScript = scripts && scripts.install;
  if (installScript && type !== "bootstrap" && ignoreScripts()) {
    process.stdout.write(`  ${yel("skipping")} install script (${installScript}) — --ignore-scripts\n`);
  } else if (installScript && type !== "bootstrap") {
    // SECURITY (#23): contain the (server-controlled) install script path to the
    // module dir — a value like ../../../etc/cron.daily/x must not be chmod+exec'd.
    const scriptPath = path.resolve(moduleDir, installScript.replace(/^\.\//, ""));
    if (!scriptPath.startsWith(path.resolve(moduleDir) + path.sep)) {
      throw new Error(`install script path '${installScript}' escapes the module directory`);
    }
    process.stdout.write(`  running install script (${installScript}${needs_sudo ? ", sudo" : ""})...\n`);
    try {
      runScript(scriptPath, moduleDir, needs_sudo);
    } catch (err) {
      // edge case 5/15: install.sh failed — clean up the half-extracted module
      // directory so the system isn't left in a partial state and so future
      // runs of adompkg list / audit don't report a phantom entry.
      try { fs.rmSync(moduleDir, { recursive: true, force: true }); } catch {}
      throw err;
    }
  }

  // postinstall lifecycle hook — runs in the installed moduleDir after
  // install.sh succeeds. npm-shaped. Fails the install if it exits non-zero.
  // Use case: post-extraction setup that needs the package contents in place
  // (e.g. compile native bindings, build assets, register the package with
  // an external service).
  const postinstallScript = scripts && scripts.postinstall;
  if (postinstallScript && ignoreScripts()) {
    process.stdout.write(`  ${yel("skipping")} postinstall (${postinstallScript}) — --ignore-scripts\n`);
  } else if (postinstallScript) {
    const hookPath = path.resolve(moduleDir, postinstallScript.replace(/^\.\//, ""));
    if (!hookPath.startsWith(path.resolve(moduleDir) + path.sep)) {
      throw new Error(`postinstall path '${postinstallScript}' escapes the module directory`);
    }
    if (fs.existsSync(hookPath)) {
      process.stdout.write(`  running postinstall (${postinstallScript})...\n`);
      try {
        runScript(hookPath, moduleDir, !!needs_sudo);
      } catch (err) {
        try { fs.rmSync(moduleDir, { recursive: true, force: true }); } catch {}
        throw new Error(`postinstall failed: ${err.message}`);
      }
    } else {
      process.stdout.write(`  ${yel("warning:")} scripts.postinstall is '${postinstallScript}' but no such file in tarball; skipping.\n`);
    }
  }

  installed[name] = {
    version,
    type,
    owner,
    slug,
    dependencies: dependencies || {},
    needs_sudo: !!needs_sudo,
    installedAt: new Date().toISOString(),
    integrity: localHash,
    org_id: org_id || null,
    org_name: org_name || null,
    dev: !!dev,
    optional: !!optional,
  };
  saveInstalled(installed);

  if (lockEntries) {
    lockEntries[name] = {
      version,
      type,
      owner,
      slug,
      integrity: localHash,
      dependencies: dependencies || {},
      tarball,
      org_id: org_id || null,
      dev: !!dev,
      optional: !!optional,
    };
  }

  process.stdout.write(`  installed ${bold(name)}@${version}${dev ? dim(" [dev]") : ""}${optional ? dim(" [optional]") : ""}\n`);
}

function parseSlugSpec(arg) {
  // A package reference is `<owner>/<slug>[@<version|tag|range>]`, e.g.
  // `adom/core@^1.0.0`. A bare `<slug>[@spec]` is also accepted. There is no
  // npm-style scope-@: the `@` only ever precedes the version, and the part
  // before it (the `ref`) may itself contain a `/` for owner/slug.
  const at = arg.lastIndexOf("@");
  if (at <= 0) return { ref: arg, slug: arg, spec: "latest" };
  const ref = arg.slice(0, at);
  return { ref, slug: ref, spec: arg.slice(at + 1) || "latest" };
}

// Split a qualified ref into { owner, slug }. A bare slug yields owner=null.
function splitRef(ref) {
  const i = ref.indexOf("/");
  if (i === -1) return { owner: null, slug: ref };
  return { owner: ref.slice(0, i), slug: ref.slice(i + 1) };
}

// Build a registry path segment for a package read route. When the ref is
// qualified (owner/slug), use the owner-scoped route; otherwise the bare slug
// route (server falls back to the unique-owner lookup).
function pkgPathSegment(ref) {
  const { owner, slug } = splitRef(ref);
  if (owner) return `${encodeURIComponent(owner)}/${encodeURIComponent(slug)}`;
  return encodeURIComponent(slug);
}

function pickFlag(args, name) {
  // --flag value
  const i = args.indexOf(name);
  if (i === -1) return { value: null, rest: args };
  const val = args[i + 1];
  return { value: val, rest: args.filter((_, idx) => idx !== i && idx !== i + 1) };
}

function pickBoolFlag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return { value: false, rest: args };
  return { value: true, rest: args.filter((_, idx) => idx !== i) };
}

// --flag a b c  (collects values until the next --flag). For repeatable /
// multi-value options like push --files and --allow-secret.
function pickMultiFlag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return { values: [], rest: args };
  let j = i + 1;
  const values = [];
  while (j < args.length && !args[j].startsWith("-")) { values.push(args[j]); j++; }
  const rest = args.filter((_, idx) => idx < i || idx >= j);
  return { values, rest };
}

// Accept `--key=value` (and `-k=value`) as equivalent to `--key value`, the
// near-universal CLI convention. pickFlag/pickBoolFlag/pickMultiFlag all match
// exact tokens, so without this `--org=adom` was silently treated as a stray
// positional and the flag's value was lost. Splits on the FIRST `=` only, so a
// value may itself contain `=` (e.g. a URL query). Bare positionals containing
// `=` (no leading dash) are left untouched.
function normalizeEqualsFlags(argv) {
  const out = [];
  for (const a of argv) {
    const m = /^(--?[A-Za-z][\w-]*)=([\s\S]*)$/.exec(a);
    if (m) { out.push(m[1], m[2]); }
    else out.push(a);
  }
  return out;
}

async function cmdInstall(args, opts = {}) {
  ensurePrefix();
  const installed = loadInstalled();
  // Refs the caller (e.g. `add -D`) knows are devDependencies — used to mark the
  // resolved entries dev, since the resolver only flags root devDependencies.
  const explicitDevRefs = opts.devRefs instanceof Set ? opts.devRefs : null;

  let { value: orgArg, rest } = pickFlag(args, "--org");
  const org = orgArg || DEFAULT_ORG;
  // --dev / -D pulls in root packages' devDependencies. Same semantics as
  // npm install --include=dev / yarn install. Transitive devDeps never walked.
  const devLong = pickBoolFlag(rest, "--dev"); rest = devLong.rest;
  const devShort = pickBoolFlag(rest, "-D"); rest = devShort.rest;
  const includeDev = devLong.value || devShort.value;

  let packages;
  if (rest.length === 0) {
    if (Object.keys(installed).length === 0) {
      // edge case 11: empty install plan — exit 0 with friendly message.
      process.stdout.write("nothing to install (no packages requested and no installed packages found)\n");
      return;
    }
    packages = {};
    for (const [name, info] of Object.entries(installed)) packages[name] = info.version;
  } else {
    packages = {};
    for (const arg of rest) {
      const { ref, spec } = parseSlugSpec(arg);
      packages[ref] = spec;
    }
  }

  process.stdout.write(`Resolving dependencies via ${REGISTRY}${org ? ` (org=${org})` : ""}${includeDev ? " (include dev)" : ""}...\n`);
  const { resolved, order, peer_warnings, optional_warnings } = await resolveTree(packages, org, { includeDev });

  // Honor an explicit dev set from the caller (`add -D`): a directly-requested
  // package isn't a root devDependency, so the resolver leaves it dev=false.
  if (explicitDevRefs) {
    for (const p of resolved) {
      if (explicitDevRefs.has(p.name) || explicitDevRefs.has(p.slug) || explicitDevRefs.has(`${p.owner}/${p.slug}`)) {
        p.dev = true;
      }
    }
  }

  // optionalDependencies that couldn't even be resolved — log but don't block.
  if (Array.isArray(optional_warnings) && optional_warnings.length > 0) {
    process.stdout.write(`\n${yel("Optional dependencies skipped:")}\n`);
    for (const w of optional_warnings) {
      process.stdout.write(`  ${w.slug}@${w.spec} — ${w.reason}${w.org_name ? ` (org: ${w.org_name})` : ""}\n`);
    }
    process.stdout.write("\n");
  }

  // peerDependencies: surface real version conflicts. Missing peers are
  // auto-installed by the resolver (npm 7+ behavior), so they never reach
  // here. The local installed set can also satisfy a peer at a different
  // version than the resolver picked, so we drop conflicts the local install
  // already covers.
  const peerActual = filterPeerWarnings(peer_warnings || [], installed);
  if (peerActual.length > 0) {
    process.stdout.write(`\n${yel("Peer dependency conflicts:")}\n`);
    for (const w of peerActual) {
      process.stdout.write(`  ${w.from} expects ${w.peer}@${w.spec} but the plan has ${w.peer}@${w.found}.\n`);
      process.stdout.write(`    Hint: pin ${w.peer} explicitly with 'adompkg install ${w.peer}@${w.spec}' to override, or update one of the parents.\n`);
    }
    process.stdout.write("\n");
  }

  process.stdout.write(`Install plan (${order.length} package${order.length === 1 ? "" : "s"}):\n`);
  for (const p of resolved) {
    const dep = p.deprecated ? yel("  DEPRECATED") : "";
    const devTag = p.dev ? dim(" [dev]") : "";
    const optTag = p.optional ? dim(" [optional]") : "";
    const id = p.name || p.slug;
    process.stdout.write(`  - ${id}@${p.version} (${p.type})${p.org_name ? ` [${p.org_name}]` : ""}${devTag}${optTag}${dep}\n`);
  }

  // engines.adompkg check — abort BEFORE any install.sh runs so a too-old CLI
  // can't half-install a package that won't actually work. Hint at bootstrap.
  const engineErrors = [];
  for (const p of resolved) {
    const req = p.engines && p.engines.adompkg;
    if (!req) continue;
    if (!satisfiesSpecLocal(VERSION, req)) {
      engineErrors.push({ slug: p.name || p.slug, version: p.version, req });
    }
  }
  if (engineErrors.length > 0) {
    process.stderr.write(`\n${red("Engine mismatch — install blocked:")}\n`);
    for (const e of engineErrors) {
      process.stderr.write(`  ${e.slug}@${e.version} requires adompkg ${e.req}, you have ${VERSION}.\n`);
    }
    process.stderr.write(`\nUpgrade with:\n  bash <(curl -fsSL ${REGISTRY}/static/bootstrap.sh)\n`);
    process.exit(EXIT_ERR);
  }
  process.stdout.write("\n");

  // Merge into existing lock so the lock file accumulates across installs.
  const existingLock = loadLock() || {};
  const lockPkgs = (existingLock.packages && typeof existingLock.packages === "object")
    ? { ...existingLock.packages }
    : {};
  const lockResolved = Array.isArray(existingLock.resolved) ? [...existingLock.resolved] : [];
  const lockOrder = Array.isArray(existingLock.order) ? [...existingLock.order] : [];

  const optionalFailures = [];
  for (const p of resolved) {
    try {
      await installOne(p, installed, lockPkgs);
    } catch (err) {
      // Optional deps don't block the install — log and move on.
      if (p.optional) {
        const id = p.name || p.slug;
        optionalFailures.push({ slug: id, version: p.version, message: err.message || String(err) });
        process.stdout.write(`  ${yel("skip")} ${id}@${p.version} (optional): ${err.message || err}\n`);
        continue;
      }
      throw err;
    }
    // Update resolved + order entries, keyed by the qualified name.
    const id = p.name || p.slug;
    const i = lockResolved.findIndex(r => (r.name || r.slug) === id);
    if (i >= 0) lockResolved[i] = p; else lockResolved.push(p);
    if (!lockOrder.includes(id)) lockOrder.push(id);
  }

  saveLock({ resolved: lockResolved, order: lockOrder, packages: lockPkgs, generatedAt: new Date().toISOString() });

  // Type breakdown helps users see when a single install pulled in skills
  // and components alongside the app — the cross-type dependency feature.
  const byType = {};
  for (const p of resolved) byType[p.type] = (byType[p.type] || 0) + 1;
  const ORDERED = ["app", "skill", "component", "bootstrap"];
  const parts = [];
  for (const t of ORDERED) {
    if (!byType[t]) continue;
    parts.push(`${byType[t]} ${t}${byType[t] === 1 ? "" : "s"}`);
  }
  const devCount = resolved.filter(p => p.dev).length;
  const optCount = resolved.filter(p => p.optional).length;
  const annotations = [];
  if (devCount > 0) annotations.push(`${devCount} dev`);
  if (optCount > 0) annotations.push(`${optCount} optional`);
  const annotSuffix = annotations.length > 0 ? ` (incl. ${annotations.join(", ")})` : "";
  process.stdout.write(`\nInstalled: ${parts.join(", ") || "0"}${annotSuffix}\n`);
  if (optionalFailures.length > 0) {
    process.stdout.write(`(${optionalFailures.length} optional dep${optionalFailures.length === 1 ? "" : "s"} skipped due to install failures)\n`);
  }
}

// ------------------------------------------------------------
// `adompkg add` — npm-style add to local package.json + install.
//
// `adompkg install` only installs into ~/project/adom_modules globally; it
// does not touch the calling project's package.json. `add` closes that loop:
// it edits the manifest in CWD AND runs the install. With no flag, the slug
// goes into "dependencies" (or "devDependencies" if the published package
// declared `scope: dev`). `--dev`/`-D` forces devDependencies; `--peer`/`-P`
// forces peerDependencies.
// ------------------------------------------------------------

function readLocalManifest(cwd) {
  const file = path.join(cwd, "package.json");
  if (!fs.existsSync(file)) {
    die("no package.json in this directory. Run 'adompkg init' first or cd into a package source dir.", EXIT_USAGE);
  }
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); }
  catch (err) { die(`failed to read ${file}: ${err.message}`); }
  let manifest;
  try { manifest = JSON.parse(raw); }
  catch (err) { die(`failed to parse ${file}: ${err.message}`); }
  // Preserve the original trailing newline if present.
  const trailingNewline = raw.endsWith("\n");
  return { file, manifest, trailingNewline };
}

function writeLocalManifest(file, manifest, trailingNewline) {
  let out = JSON.stringify(manifest, null, 2);
  if (trailingNewline) out += "\n";
  fs.writeFileSync(file, out, "utf8");
}

async function cmdAdd(args) {
  let { value: orgArg, rest } = pickFlag(args, "--org");
  const org = orgArg || DEFAULT_ORG;
  const devLong = pickBoolFlag(rest, "--dev"); rest = devLong.rest;
  const devShort = pickBoolFlag(rest, "-D"); rest = devShort.rest;
  const peerLong = pickBoolFlag(rest, "--peer"); rest = peerLong.rest;
  const peerShort = pickBoolFlag(rest, "-P"); rest = peerShort.rest;
  const explicitDev = devLong.value || devShort.value;
  const explicitPeer = peerLong.value || peerShort.value;
  if (explicitDev && explicitPeer) {
    die("--dev and --peer are mutually exclusive (a single dep can only live in one section).", EXIT_USAGE);
  }
  const targetSection = explicitPeer ? "peerDependencies" : (explicitDev ? "devDependencies" : null);

  if (rest.length === 0) {
    die("usage: adompkg add <owner>/<slug>[@version] [...] [--dev|-D|--peer|-P] [--org <slug>]", EXIT_USAGE);
  }

  const cwd = process.cwd();
  const { file, manifest, trailingNewline } = readLocalManifest(cwd);

  // For each ref: look up the published manifest to (a) learn the latest
  // version for the spec default and (b) read the author's scope hint so we
  // can route a default-call to the right section. The dependency key stored
  // in package.json is the ref the user typed (qualified <owner>/<slug> or
  // bare <slug>).
  const adds = [];
  for (const arg of rest) {
    const { ref, spec } = parseSlugSpec(arg);
    let chosenVersion = null;
    let publishedScope = null;
    try {
      const qs = org ? `?org=${encodeURIComponent(org)}` : "";
      const published = await httpJson(`${REGISTRY}/api/v1/packages/${pkgPathSegment(ref)}/manifest${qs}`);
      chosenVersion = published.version;
      publishedScope = published.scope || null;
    } catch (err) {
      if (err.status === 404) die(`package not found: ${ref}. Run 'adompkg search ${splitRef(ref).slug}' to discover similar slugs.`);
      throw err;
    }
    // If the caller didn't pin a version, default to ^X.Y.Z. If they did,
    // keep what they passed verbatim.
    const usedSpec = spec === "latest" ? `^${chosenVersion}` : spec;
    let section = targetSection;
    if (!section) {
      // Honor the author's scope hint when the consumer didn't say.
      if (publishedScope === "dev") section = "devDependencies";
      else section = "dependencies";
      if (publishedScope === "dev") {
        process.stdout.write(`${dim(`note: ${ref} declares scope="dev"; routing to devDependencies.`)}\n`);
      }
    }
    adds.push({ ref, spec: usedSpec, section });
  }

  // Apply to manifest.
  for (const a of adds) {
    if (!manifest[a.section] || typeof manifest[a.section] !== "object") manifest[a.section] = {};
    // If the ref is already in a different section, leave the old entry
    // alone — let the user clean it up rather than silently moving it.
    const otherSections = ["dependencies", "devDependencies", "peerDependencies"].filter(s => s !== a.section);
    for (const other of otherSections) {
      if (manifest[other] && Object.prototype.hasOwnProperty.call(manifest[other], a.ref)) {
        process.stdout.write(`${yel(`warning:`)} ${a.ref} already in ${other}; leaving it there. Remove it manually if you want it only in ${a.section}.\n`);
      }
    }
    manifest[a.section][a.ref] = a.spec;
    process.stdout.write(`Added ${bold(a.ref)}@${a.spec} to ${a.section}\n`);
  }

  writeLocalManifest(file, manifest, trailingNewline);
  process.stdout.write(`Wrote ${file}\n\n`);

  // Install everything we just added so the author can develop against it
  // immediately. Matches npm install --save / --save-peer / --save-dev.
  // peerDependencies are installed for the author's local dev workflow even
  // though they wouldn't be auto-installed by a consumer doing a fresh
  // install of THIS package — the consumer's resolver will pick them up
  // through their own root, where peer-dep auto-install kicks in.
  if (adds.length > 0) {
    const installArgs = adds.map(a => `${a.ref}@${a.spec}`);
    if (org) installArgs.push("--org", org);
    if (adds.some(a => a.section === "devDependencies")) installArgs.push("--dev");
    // The resolver only flags a package "dev" when it's a root devDependency;
    // a directly-requested package isn't, so without this the dep we just routed
    // to devDependencies would be recorded as runtime in .installed.json (and
    // `list`/`uninstall --dev` would miss it). Tell cmdInstall which refs are dev.
    const devRefs = new Set();
    for (const a of adds) {
      if (a.section === "devDependencies") {
        devRefs.add(a.ref);
        devRefs.add(splitRef(a.ref).slug);
      }
    }
    await cmdInstall(installArgs, { devRefs });
  }
}

// ------------------------------------------------------------
// Uninstall (proper transitive cleanup with refcount)
// ------------------------------------------------------------

function isStillNeeded(dep, installed, toRemove) {
  for (const [name, meta] of Object.entries(installed)) {
    if (toRemove.has(name)) continue;
    const dm = meta.dependencies || {};
    if (Object.prototype.hasOwnProperty.call(dm, dep)) return true;
  }
  return false;
}

function dependentsOf(slug, installed) {
  const out = [];
  for (const [other, info] of Object.entries(installed)) {
    if (other === slug) continue;
    if (info.dependencies && Object.prototype.hasOwnProperty.call(info.dependencies, slug)) {
      out.push(other);
    }
  }
  return out;
}

function topologicalRemovalOrder(toRemoveArr, installed) {
  // Remove dependents (parents) first, then their dependencies (leaves last).
  // i.e. iterate in reverse of install order. Since installed.dependencies are
  // pointers from parent -> child, we want to remove parents before children.
  // For two packages A->B in toRemove, A must come first (no other package
  // points to A; removing A leaves B with one fewer reference).
  const toRemoveSet = new Set(toRemoveArr);
  // Build: indegree[x] = number of pkgs in toRemove that depend on x.
  const indegree = {};
  for (const slug of toRemoveSet) indegree[slug] = 0;
  for (const slug of toRemoveSet) {
    const meta = installed[slug];
    if (!meta) continue;
    for (const dep of Object.keys(meta.dependencies || {})) {
      if (toRemoveSet.has(dep)) indegree[dep] = (indegree[dep] || 0) + 1;
    }
  }
  // Kahn's: start with indegree == 0 (no one in the set depends on them).
  const order = [];
  const queue = [];
  for (const [slug, d] of Object.entries(indegree)) if (d === 0) queue.push(slug);
  while (queue.length) {
    const cur = queue.shift();
    order.push(cur);
    const meta = installed[cur];
    if (!meta) continue;
    for (const dep of Object.keys(meta.dependencies || {})) {
      if (!toRemoveSet.has(dep)) continue;
      indegree[dep]--;
      if (indegree[dep] === 0) queue.push(dep);
    }
  }
  // If any not visited (cycle in install graph — unlikely), append them.
  for (const slug of toRemoveSet) if (!order.includes(slug)) order.push(slug);
  return order;
}

// Resolve a user-supplied package reference (qualified <owner>/<slug> or bare
// <slug>) to the key under which it's recorded in the installed registry.
// Exact key match wins; otherwise a bare ref matches a unique <owner>/<slug>
// whose slug equals the ref. Returns the matched key, or null.
function resolveInstalledKey(ref, installed) {
  if (Object.prototype.hasOwnProperty.call(installed, ref)) return ref;
  if (!ref.includes("/")) {
    const matches = Object.keys(installed).filter(k => {
      const info = installed[k] || {};
      return info.slug === ref || k.endsWith(`/${ref}`);
    });
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      die(`ambiguous: '${ref}' matches ${matches.join(", ")}. Qualify with <owner>/<slug>.`, EXIT_USAGE);
    }
  }
  return null;
}

async function cmdUninstall(args) {
  const { value: force, rest: r1 } = pickBoolFlag(args, "--force");
  const { value: noPruneFlag, rest: r2a } = pickBoolFlag(r1, "--no-prune");
  const { value: pruneFlag, rest: r2 } = pickBoolFlag(r2a, "--prune");
  const positionals = r2.filter(a => !a.startsWith("-"));
  if (positionals.length === 0) usage("usage: adompkg uninstall <owner>/<slug> [--force] [--no-prune] [--prune]");
  const ref = positionals[0];

  const installed = loadInstalled();
  const slug = resolveInstalledKey(ref, installed);
  if (!slug) die(`not installed: ${ref}. Run 'adompkg list' to see what is installed.`, EXIT_USAGE);

  const deps = dependentsOf(slug, installed);
  if (deps.length > 0 && !force) {
    die(`${slug} is required by: ${deps.join(", ")}. Use --force to remove anyway.`);
  }

  // edge case 14: bootstrap packages are pure aggregators (e.g. adom/core).
  // The deps are user-facing tools the user likely wants to keep. Default to
  // no-prune for bootstrap. The user can opt in to pruning with --prune.
  const isBootstrap = installed[slug]?.type === "bootstrap";
  let noPrune = noPruneFlag;
  if (isBootstrap && !pruneFlag) noPrune = true;

  const toRemove = new Set([slug]);

  if (!noPrune) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const removing of [...toRemove]) {
        const meta = installed[removing];
        if (!meta) continue;
        for (const dep of Object.keys(meta.dependencies || {})) {
          if (toRemove.has(dep)) continue;
          if (!installed[dep]) continue;
          if (!isStillNeeded(dep, installed, toRemove)) {
            toRemove.add(dep);
            changed = true;
          }
        }
      }
    }
  }

  const order = topologicalRemovalOrder([...toRemove], installed);

  process.stdout.write(`Removing ${order.length} package(s): ${order.join(", ")}\n`);

  // Track stash entries we can drop once the trunk is gone. Stashes live
  // in PREFIX/.link-stash/index.json; entries are orphaned when their slug
  // is uninstalled (the trunk is gone, the user can't `unlink` to restore).
  const stashIndexPath = path.join(PREFIX, ".link-stash", "index.json");
  let stashIndex = null;
  if (fs.existsSync(stashIndexPath)) {
    try { stashIndex = JSON.parse(fs.readFileSync(stashIndexPath, "utf8")); } catch { stashIndex = null; }
  }

  for (const pkg of order) {
    const info = installed[pkg];
    // Prefer the stored owner/slug; fall back to parsing the registry key
    // (which is the qualified name or a legacy bare slug).
    const dir = (info && info.slug)
      ? moduleDirFor(info.owner || null, info.slug)
      : moduleDirFor(pkg);
    // A linked package's trunk is a symlink to a dev checkout. We must
    // NOT recurse into the link target on `rm` (Node's rmSync correctly
    // unlinks-only, but flag it for the user so they know their dev
    // checkout survived the uninstall).
    let linkTarget = null;
    try {
      const st = fs.lstatSync(dir);
      if (st.isSymbolicLink()) linkTarget = fs.readlinkSync(dir);
    } catch {}

    if (info && info.type !== "bootstrap") {
      const scriptPath = path.join(dir, "uninstall.sh");
      if (fs.existsSync(scriptPath)) {
        process.stdout.write(`  - ${pkg}: running uninstall.sh${linkTarget ? dim(` (linked -> ${linkTarget})`) : ""}\n`);
        try {
          runScript(scriptPath, dir, info.needs_sudo);
        } catch (err) {
          process.stderr.write(`    Warning: uninstall script failed: ${err.message}\n`);
        }
      } else {
        process.stdout.write(`  - ${pkg}: (no uninstall.sh)${linkTarget ? dim(` (linked -> ${linkTarget})`) : ""}\n`);
      }
    } else {
      process.stdout.write(`  - ${pkg}${linkTarget ? dim(` (linked -> ${linkTarget})`) : ""}\n`);
    }

    if (linkTarget) {
      // Remove only the symlink — fs.rmSync on a symlink unlinks the link,
      // doesn't recurse into the target. Logged explicitly so the user
      // knows their dev checkout survived.
      try { fs.unlinkSync(dir); } catch {}
      process.stdout.write(`    ${dim(`dev checkout at ${linkTarget} is untouched`)}\n`);
    } else if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    // Clean any stash for this slug — there's no longer a trunk to restore
    // it to, so the stash is dead weight on disk. Skip if the user is
    // re-linking from a different checkout (handled separately by link).
    if (stashIndex && stashIndex[pkg]) {
      try { fs.rmSync(stashIndex[pkg], { recursive: true, force: true }); } catch {}
      delete stashIndex[pkg];
    }

    delete installed[pkg];
  }

  // Persist stash-index cleanup.
  if (stashIndex !== null) {
    try { fs.writeFileSync(stashIndexPath, JSON.stringify(stashIndex, null, 2)); } catch {}
  }

  saveInstalled(installed);

  // Rewrite the lock file from the remaining installed set.
  const lock = loadLock();
  if (lock && lock.packages) {
    for (const key of order) delete lock.packages[key];
    lock.resolved = (lock.resolved || []).filter(r => !order.includes(r.name || r.slug));
    lock.order = (lock.order || []).filter(s => !order.includes(s));
    lock.generatedAt = new Date().toISOString();
    saveLock(lock);
  }

  process.stdout.write("Done.\n");
}

// ------------------------------------------------------------
// List / outdated / update
// ------------------------------------------------------------

function pad(s, n) {
  s = String(s);
  if (s.length >= n) return s;
  return s + " ".repeat(n - s.length);
}

// ------------------------------------------------------------
// `adompkg why <slug>` — reverse-dependency trace.
//
// "Why is this package installed?" Walks the installed-set BACKWARDS from
// the target slug. A package Y is a parent of X iff Y's recorded
// dependencies include X. A root is a package no installed package depends
// on (npm's heuristic — we don't record requestedBy explicitly).
//
// Multiple paths may converge on the target; we render all of them as a
// tree, deduping a parent that appears more than once via "(see above)".
// ------------------------------------------------------------

function buildParentIndex(installed) {
  // slug -> Set<parentSlug>
  const parents = {};
  for (const [parentSlug, info] of Object.entries(installed)) {
    for (const childSlug of Object.keys(info.dependencies || {})) {
      if (!parents[childSlug]) parents[childSlug] = new Set();
      parents[childSlug].add(parentSlug);
    }
  }
  return parents;
}

// ------------------------------------------------------------
// `adompkg link <slug> <path>` — point an installed slug at a dev checkout.
//
// With the symlink convention, every install target (~/.local/bin/<name>,
// ~/.claude/skills/<slug>/, etc.) is a symlink into
// ~/project/adom_modules/<slug>/. So "linking a dev checkout" is just:
// swap THAT one trunk symlink to point at <path>. Every downstream
// install target follows automatically — no individual relinking.
//
//   adompkg link <slug> <path>     point <slug> at <path> (must contain package.json with matching slug)
//   adompkg link <slug>            point <slug> at $(pwd)
//   adompkg unlink <slug>          restore the trunk to a regular extracted dir from cache
// ------------------------------------------------------------

function cmdLink(args) {
  if (args.length === 0) die("usage: adompkg link <owner>/<slug> [<path>]", EXIT_USAGE);
  const ref = args[0];
  const linkTarget = path.resolve(args[1] || process.cwd());

  if (!fs.existsSync(linkTarget)) {
    die(`link target does not exist: ${linkTarget}`, EXIT_USAGE);
  }
  const pkgJson = path.join(linkTarget, "package.json");
  if (!fs.existsSync(pkgJson)) {
    die(`no package.json at ${linkTarget}; can't verify slug match.`, EXIT_USAGE);
  }
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(pkgJson, "utf8")); }
  catch (err) { die(`failed to parse ${pkgJson}: ${err.message}`); }

  // The ref identifies the package; its slug portion must match the manifest.
  const { owner: refOwner, slug } = splitRef(ref);
  if (manifest.slug && manifest.slug !== slug) {
    die(`package.json declares slug='${manifest.slug}' but you asked to link as '${slug}'. Refuse — this would mis-route every downstream install target.`, EXIT_USAGE);
  }
  // Owner comes from the ref if qualified, else the manifest's owner field,
  // else stays null (flat back-compat layout).
  const owner = refOwner || manifest.owner || null;
  // Qualified name is the install-registry key + stash key.
  const name = owner ? `${owner}/${slug}` : slug;

  ensurePrefix();
  const moduleDir = moduleDirFor(owner, slug);
  // If there's already something at moduleDir, archive it first so unlink
  // can restore. We move (rename) rather than rm so even non-symlink
  // extracted trees survive a link/unlink round-trip.
  const stashDir = path.join(PREFIX, ".link-stash");
  if (!fs.existsSync(stashDir)) fs.mkdirSync(stashDir, { recursive: true });
  // Ensure the parent <owner>/ dir exists for the symlink we're about to make.
  fs.mkdirSync(path.dirname(moduleDir), { recursive: true });
  // Detect "something is at moduleDir" — existsSync is false for dangling
  // symlinks, so check lstatSync separately.
  let moduleDirOccupied = false;
  try { fs.lstatSync(moduleDir); moduleDirOccupied = true; } catch {}
  if (moduleDirOccupied) {
    try {
      const stashTarget = path.join(stashDir, `${name.replace(/\//g, "__")}-${Date.now()}`);
      fs.renameSync(moduleDir, stashTarget);
      // Persist a pointer so unlink knows where the stash went.
      const stashIndex = path.join(stashDir, "index.json");
      let idx = {};
      if (fs.existsSync(stashIndex)) {
        try { idx = JSON.parse(fs.readFileSync(stashIndex, "utf8")); } catch {}
      }
      idx[name] = stashTarget;
      fs.writeFileSync(stashIndex, JSON.stringify(idx, null, 2));
    } catch (err) {
      die(`failed to stash existing ${moduleDir}: ${err.message}`);
    }
  }

  fs.symlinkSync(linkTarget, moduleDir);
  // Mark the install record so list / why / audit know it's a link.
  const installed = loadInstalled();
  installed[name] = {
    ...(installed[name] || {}),
    version: manifest.version || installed[name]?.version || "0.0.0",
    type: manifest.type || installed[name]?.type || "app",
    owner,
    slug,
    dependencies: manifest.dependencies || {},
    installedAt: new Date().toISOString(),
    linked: linkTarget,
  };
  saveInstalled(installed);

  process.stdout.write(`Linked ${bold(name)} -> ${linkTarget}\n`);
  process.stdout.write(`(downstream symlinks — binaries on PATH, ~/.claude/skills/${slug}/, etc. — follow automatically because they were created as symlinks INTO ${moduleDir}/)\n`);
}

function cmdUnlink(args) {
  if (args.length === 0) die("usage: adompkg unlink <owner>/<slug>", EXIT_USAGE);
  const ref = args[0];
  const installed = loadInstalled();
  // Resolve the ref to the install-registry key so we can recover the stored
  // owner/slug; fall back to treating the ref itself as the key.
  const name = resolveInstalledKey(ref, installed) || ref;
  const info = installed[name] || {};
  const { owner: refOwner, slug: refSlug } = splitRef(name);
  const owner = info.owner !== undefined ? info.owner : refOwner;
  const slug = info.slug || refSlug;
  const moduleDir = moduleDirFor(owner, slug);
  let isLink = false;
  try { isLink = fs.lstatSync(moduleDir).isSymbolicLink(); } catch {}
  if (!isLink) {
    die(`${name} is not currently linked (no symlink at ${moduleDir}).`, EXIT_USAGE);
  }

  // Remove the symlink.
  fs.unlinkSync(moduleDir);

  // Try to restore the most recent stash for this package (keyed by name).
  const stashIndex = path.join(PREFIX, ".link-stash", "index.json");
  if (fs.existsSync(stashIndex)) {
    let idx = {};
    try { idx = JSON.parse(fs.readFileSync(stashIndex, "utf8")); } catch {}
    const stashed = idx[name];
    if (stashed && fs.existsSync(stashed)) {
      fs.renameSync(stashed, moduleDir);
      delete idx[name];
      fs.writeFileSync(stashIndex, JSON.stringify(idx, null, 2));
      process.stdout.write(`Unlinked ${bold(name)} and restored the previous extracted tree from stash.\n`);
    } else {
      process.stdout.write(`Unlinked ${bold(name)}. No stash to restore — run 'adompkg install ${name}' to reinstall.\n`);
    }
  } else {
    process.stdout.write(`Unlinked ${bold(name)}. Run 'adompkg install ${name}' to reinstall.\n`);
  }

  if (installed[name]) {
    delete installed[name].linked;
    saveInstalled(installed);
  }
}

function cmdWhy(args) {
  if (args.length === 0) {
    die("usage: adompkg why <owner>/<slug>", EXIT_USAGE);
  }
  const ref = args[0];
  const installed = loadInstalled();
  const target = resolveInstalledKey(ref, installed);
  if (!target) {
    die(`not installed: ${ref}. Run 'adompkg search ${splitRef(ref).slug}' or 'adompkg list' to see what is installed.`, EXIT_USAGE);
  }

  const parents = buildParentIndex(installed);

  // A package is a root if no installed pkg depends on it.
  function isRoot(slug) {
    return !parents[slug] || parents[slug].size === 0;
  }

  const info = installed[target];
  const devTag = info.dev ? dim(" [dev]") : "";
  process.stdout.write(`${bold(target)}@${info.version}${devTag}\n`);

  const directParents = parents[target] ? [...parents[target]] : [];
  if (directParents.length === 0) {
    process.stdout.write(`${dim("(installed directly — no other package depends on this)")}\n`);
    return;
  }

  // DFS upward. Track seen-on-stack to avoid infinite loops (shouldn't
  // happen since resolver forbids cycles, but defensive). Track
  // seen-globally so duplicate subtrees collapse to "(see above)".
  const printed = new Set();
  function renderUp(slug, prefix, isLast, stack) {
    const branch = isLast ? "└── " : "├── ";
    const info = installed[slug] || { version: "?" };
    const root = isRoot(slug) ? ` ${grn("(root)")}` : "";
    const devMark = info.dev ? dim(" [dev]") : "";
    const dupMark = printed.has(slug) ? dim(" (see above)") : "";
    process.stdout.write(`${prefix}${branch}${slug}@${info.version}${devMark}${root}${dupMark}\n`);
    if (printed.has(slug)) return;
    printed.add(slug);
    if (stack.has(slug)) return; // cycle guard
    const myParents = parents[slug] ? [...parents[slug]] : [];
    const nextStack = new Set(stack);
    nextStack.add(slug);
    const childPrefix = prefix + (isLast ? "    " : "│   ");
    myParents.forEach((p, i) => {
      renderUp(p, childPrefix, i === myParents.length - 1, nextStack);
    });
  }

  directParents.forEach((p, i) => {
    renderUp(p, "", i === directParents.length - 1, new Set([target]));
  });
}

function cmdList() {
  const installed = loadInstalled();
  const names = Object.keys(installed).sort();
  if (names.length === 0) {
    process.stdout.write("No packages installed.\n");
    return;
  }
  process.stdout.write(`${bold(pad("PACKAGE", 36))}  ${bold(pad("VERSION", 12))}  ${bold(pad("TYPE", 8))}  ${bold(pad("ORG", 14))}  ${bold(pad("DEPS", 6))}  ${bold("SCOPE")}\n`);
  for (const name of names) {
    const info = installed[name];
    const depsCount = Object.keys(info.dependencies || {}).length;
    const scope = info.dev ? dim("dev") : "runtime";
    process.stdout.write(`${pad(name, 36)}  ${pad(info.version, 12)}  ${pad(info.type || "?", 8)}  ${pad(info.org_name || info.org_id || "-", 14)}  ${pad(depsCount, 6)}  ${scope}\n`);
  }
}

async function cmdOutdated(args) {
  const jsonFlag = args.includes("--json");
  const quietFlag = args.includes("--quiet") || args.includes("-q");
  const installed = loadInstalled();
  const names = Object.keys(installed);
  if (names.length === 0) {
    if (jsonFlag) { process.stdout.write(JSON.stringify({ outdated: [] }) + "\n"); return; }
    if (quietFlag) return;
    process.stdout.write("No packages installed.\n"); return;
  }
  const rows = [];
  for (const name of names) {
    try {
      // Owner-scoped route when the install record carries owner+slug (or the
      // key itself is qualified); else the bare-slug route.
      const seg = installed[name].slug
        ? pkgPathSegment(installed[name].owner ? `${installed[name].owner}/${installed[name].slug}` : installed[name].slug)
        : pkgPathSegment(name);
      const versions = await httpJson(`${REGISTRY}/api/v1/packages/${seg}/versions`);
      const list = versions.versions || [];
      if (list.length === 0) continue;
      // The versions list is DESC and INCLUDES prereleases, but `update`
      // installs the latest STABLE (the server picks the newest non-prerelease
      // for *). Comparing against list[0] would nag about a beta that `update`
      // refuses to install. Prefer the newest stable; fall back to list[0] only
      // when a package has nothing but prereleases.
      const isPre = v => /^\d+\.\d+\.\d+-/.test(v || "");
      const stable = list.filter(v => !isPre(v.version));
      const latest = (stable[0] || list[0]).version;
      if (latest !== installed[name].version) {
        rows.push({ slug: name, installed: installed[name].version, latest });
      }
    } catch {}
  }
  if (jsonFlag) {
    process.stdout.write(JSON.stringify({ outdated: rows }) + "\n");
    return;
  }
  if (quietFlag) {
    if (rows.length === 0) return;
    process.stdout.write(`${rows.length} package${rows.length === 1 ? "" : "s"} ha${rows.length === 1 ? "s" : "ve"} updates available — run \`adompkg update\`\n`);
    process.exit(1);
  }
  if (rows.length === 0) { process.stdout.write("All packages up to date.\n"); return; }
  process.stdout.write(`${bold(pad("PACKAGE", 36))}  ${bold(pad("INSTALLED", 12))}  ${bold("LATEST")}\n`);
  for (const r of rows) process.stdout.write(`${pad(r.slug, 36)}  ${pad(r.installed, 12)}  ${r.latest}\n`);
}

async function cmdUpdate(args) {
  const { value: orgArg, rest } = pickFlag(args, "--org");
  const org = orgArg || DEFAULT_ORG;
  const installed = loadInstalled();
  let targets;
  if (rest.length > 0) {
    targets = {};
    for (const arg of rest) {
      const ref = parseSlugSpec(arg).ref;
      const key = resolveInstalledKey(ref, installed);
      if (!key) die(`not installed: ${ref}. Run 'adompkg list' to see what is installed.`, EXIT_USAGE);
      // Resolve by the qualified key so the server returns the right owner's
      // package; the resolver accepts a qualified <owner>/<slug> ref.
      targets[key] = "*";
    }
  } else {
    targets = {};
    for (const name of Object.keys(installed)) targets[name] = "*";
  }
  process.stdout.write(`Resolving latest versions...\n`);
  const { resolved, order } = await resolveTree(targets, org);
  const toInstall = resolved.filter(p => {
    const id = p.name || p.slug;
    return !installed[id] || installed[id].version !== p.version;
  });
  if (toInstall.length === 0) { process.stdout.write("All packages are already up to date.\n"); return; }
  process.stdout.write(`Updating ${toInstall.length} package${toInstall.length === 1 ? "" : "s"}:\n`);
  for (const p of toInstall) {
    const id = p.name || p.slug;
    const old = installed[id]?.version || "(not installed)";
    process.stdout.write(`  - ${id}: ${old} -> ${p.version}\n`);
  }
  process.stdout.write("\n");
  // Bug-fix: merge into the existing lock so partial-target updates (e.g.
  // `adompkg update foo`) don't wipe entries for other installed packages.
  const existingLock = loadLock() || {};
  const lockPkgs = (existingLock.packages && typeof existingLock.packages === "object")
    ? { ...existingLock.packages }
    : {};
  const lockResolved = Array.isArray(existingLock.resolved) ? [...existingLock.resolved] : [];
  const lockOrder = Array.isArray(existingLock.order) ? [...existingLock.order] : [];
  for (const p of resolved) {
    await installOne(p, installed, lockPkgs);
    const id = p.name || p.slug;
    const i = lockResolved.findIndex(r => (r.name || r.slug) === id);
    if (i >= 0) lockResolved[i] = p; else lockResolved.push(p);
    if (!lockOrder.includes(id)) lockOrder.push(id);
  }
  saveLock({ resolved: lockResolved, order: lockOrder, packages: lockPkgs, generatedAt: new Date().toISOString() });
  process.stdout.write("Update complete.\n");
}

// ------------------------------------------------------------
// Publish + Pack
// ------------------------------------------------------------

function readManifestFromCwd(cwd) {
  for (const name of ["package.json", "page.json"]) {
    const p = path.join(cwd, name);
    if (fs.existsSync(p)) {
      try { return { manifest: JSON.parse(fs.readFileSync(p, "utf8")), file: name }; }
      catch (err) { die(`failed to parse ${name} in ${cwd}: ${err.message}`, EXIT_USAGE); }
    }
  }
  die(`no package.json or page.json in ${cwd}. Run 'adompkg init <slug>' to scaffold a new package.`, EXIT_USAGE);
}

// Build the set of files the publish/pack should include.
// Honors `files` whitelist if present. Always includes package.json/README/LICENSE.
// Always excludes node_modules/, .git/, .adompkg/, *.tgz, .adomignore.
function collectFiles(cwd, manifest) {
  const ALWAYS_EXCLUDE_DIRS = new Set(["node_modules", ".git", ".adompkg", ".adompkg-build"]);
  const ALWAYS_EXCLUDE_NAMES = new Set([".adomignore"]);
  const ALWAYS_INCLUDE_NAMES = new Set(["package.json", "README.md", "LICENSE"]);

  function walk(dir, relBase, out) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = entry.name;
      const rel = relBase ? `${relBase}/${name}` : name;
      if (entry.isDirectory()) {
        if (ALWAYS_EXCLUDE_DIRS.has(name)) continue;
        walk(path.join(dir, name), rel, out);
      } else if (entry.isFile()) {
        if (ALWAYS_EXCLUDE_NAMES.has(name)) continue;
        if (name.endsWith(".tgz")) continue;
        out.push(rel);
      }
    }
  }

  const all = [];
  walk(cwd, "", all);

  // Filter by `files` whitelist if present.
  const files = Array.isArray(manifest.files) ? manifest.files : null;
  if (!files) return all;

  // Glob support: ** and * via minimal matcher.
  function globToRe(glob) {
    let re = "^";
    for (let i = 0; i < glob.length; i++) {
      const c = glob[i];
      if (c === "*") {
        if (glob[i + 1] === "*") {
          re += ".*";
          i++;
        } else {
          re += "[^/]*";
        }
      } else if (c === "?") {
        re += "[^/]";
      } else if (/[.+^${}()|[\]\\]/.test(c)) {
        re += `\\${c}`;
      } else {
        re += c;
      }
    }
    re += "$";
    return new RegExp(re);
  }

  const patterns = files.map(globToRe);
  const filtered = all.filter(p => {
    if (ALWAYS_INCLUDE_NAMES.has(path.basename(p)) && !p.includes("/")) return true;
    return patterns.some(re => re.test(p));
  });

  // Make sure always-include files exist.
  for (const n of ALWAYS_INCLUDE_NAMES) {
    if (fs.existsSync(path.join(cwd, n)) && !filtered.includes(n)) {
      filtered.push(n);
    }
  }
  return filtered;
}

function buildTarball(cwd, slug, version, manifest, outPath) {
  const files = collectFiles(cwd, manifest);
  if (files.length === 0) die("nothing to package: no files matched after applying excludes / the 'files' whitelist. Check your package.json 'files' field and .adomignore.", EXIT_USAGE);
  const tmp = outPath || path.join(os.tmpdir(), `${slug}-${version}.tgz`);
  if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  const listFile = path.join(os.tmpdir(), `adompkg-files-${process.pid}-${Date.now()}.txt`);
  fs.writeFileSync(listFile, files.map(f => `./${f}`).join("\n") + "\n");
  try {
    execFileSync("tar", ["czf", tmp, "-C", cwd, "-T", listFile], { stdio: "inherit" });
  } finally {
    try { fs.unlinkSync(listFile); } catch {}
  }
  return { tarPath: tmp, files };
}

function validateLocal(manifest, cwd) {
  const errs = [];
  if (!manifest.slug) errs.push("slug is required");
  if (!manifest.version) errs.push("version is required");
  if (!manifest.type) errs.push("type is required");
  // edge case 17: match the server's description quality rules so we fail
  // fast locally and don't waste an upload on a guaranteed-rejection.
  if (!manifest.description) {
    errs.push("description is required");
  } else if (typeof manifest.description !== "string") {
    errs.push("description must be a string");
  } else {
    const d = manifest.description.trim();
    if (!d) {
      errs.push("description is required (must be non-empty)");
    } else if (d.length < 20) {
      errs.push("description must be at least 20 characters");
    }
    const lazy = ["initial commit", "todo", "tbd", "wip", "placeholder"];
    if (lazy.includes(d.toLowerCase())) {
      errs.push(`description must be meaningful (not "${d}")`);
    }
  }
  if (!manifest.dependencies) errs.push("dependencies is required (use {} if none)");

  if (manifest.type === "app" || manifest.type === "skill") {
    if (!manifest.scripts || manifest.scripts.install !== "./install.sh") {
      errs.push('scripts.install must be "./install.sh"');
    }
    if (!manifest.scripts || manifest.scripts.uninstall !== "./uninstall.sh") {
      errs.push('scripts.uninstall must be "./uninstall.sh"');
    }
    if (!fs.existsSync(path.join(cwd, "install.sh"))) errs.push("install.sh missing from project root");
    if (!fs.existsSync(path.join(cwd, "uninstall.sh"))) errs.push("uninstall.sh missing from project root");
  } else if (manifest.type === "bootstrap") {
    if (manifest.scripts && (manifest.scripts.install || manifest.scripts.uninstall)) {
      errs.push("meta packages must not have scripts.install/uninstall");
    }
  }
  return errs;
}

async function cmdPack(args) {
  const { value: outArg, rest } = pickFlag(args, "--out");
  const cwd = process.cwd();
  const { manifest, file } = readManifestFromCwd(cwd);
  process.stdout.write(`Packing from ${file} in ${cwd}\n`);
  const errs = validateLocal(manifest, cwd);
  if (errs.length > 0) {
    process.stderr.write("Validation failed:\n");
    for (const e of errs) process.stderr.write(`  - ${e}\n`);
    process.exit(1);
  }
  const outPath = outArg ? path.resolve(outArg) : path.join(cwd, `${manifest.slug}-${manifest.version}.tgz`);
  const { tarPath, files } = buildTarball(cwd, manifest.slug, manifest.version, manifest, outPath);
  const stat = fs.statSync(tarPath);
  process.stdout.write(`\nTarball: ${tarPath}\n`);
  process.stdout.write(`Files:   ${files.length}\n`);
  process.stdout.write(`Size:    ${stat.size} bytes\n`);
  process.stdout.write(`SHA-256: ${sha256File(tarPath)}\n`);
}

// ------------------------------------------------------------
// Pre-publish lint.
//
// Always runs during `adompkg publish`. Each check returns:
//   { level: "error" | "warning", message: string }
// Errors block; warnings print but let the publish through.
//
// The checks live here in adompkg (not in a separate binary) so every author
// gets them automatically. They are deliberately conservative — anything
// codebase-specific (Adom MCP, kicad-cli, etc.) belongs in the standalone
// adom-publish-linter that runs alongside this.
// ------------------------------------------------------------

// Regex set for the secret scan. Each entry is { name, re, scope }.
// scope=path means "filename match"; scope=content means "file contents".
// Conservative — false positives here mean publishes get blocked.
const SECRET_PATTERNS = [
  { name: "GitHub personal access token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, scope: "content" },
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/, scope: "content" },
  { name: "Stripe live key", re: /\bsk_live_[A-Za-z0-9]{24,}\b/, scope: "content" },
  { name: "Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{32,}\b/, scope: "content" },
  { name: "OpenAI API key", re: /\bsk-[A-Za-z0-9]{32,}\b/, scope: "content" },
  { name: "GitLab personal access token", re: /\bglpat-[A-Za-z0-9_-]{20,}\b/, scope: "content" },
  { name: "Slack webhook", re: /hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/, scope: "content" },
  { name: "Private key file (.pem/.key)", re: /\.(pem|key)$/, scope: "path" },
  { name: "PEM-encoded private key", re: /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, scope: "content" },
];

// Same secret rules as the publish lint, but line-numbered for `push` reporting.
// Honors the `adom-wiki-publish: allow-secret` pragma and --allow-secret substrings.
const ALLOW_SECRET_PRAGMA = "adom-wiki-publish: allow-secret";
function scanTextForSecrets(text, allow = []) {
  const hits = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(ALLOW_SECRET_PRAGMA)) continue;
    if (allow.some(a => a && line.includes(a))) continue;
    for (const pat of SECRET_PATTERNS) {
      if (pat.scope !== "content") continue;
      if (pat.re.test(line)) hits.push({ name: pat.name, line: i + 1, excerpt: line.slice(0, 160).trim() });
    }
  }
  return hits;
}

function lintReadme(cwd, manifest) {
  const results = [];
  const readmePath = path.join(cwd, "README.md");
  if (!fs.existsSync(readmePath)) {
    results.push({ level: "error", message: "README.md is required to publish — add one describing the package (the registry rejects publishes without it)." });
    return results;
  }
  const readme = fs.readFileSync(readmePath, "utf8");
  if (readme.trim().length === 0) {
    results.push({ level: "error", message: "README.md is empty — it must describe the package to publish." });
    return results;
  }
  if (readme.trim().length < 200) {
    results.push({ level: "warning", message: `README.md is only ${readme.trim().length} chars; aim for at least 200 with a real description and examples.` });
  }
  // App/skill pages benefit hugely from inline screenshots (Bug #15 fix makes
  // them work). Warn if a publishable package has none.
  if ((manifest.type === "app" || manifest.type === "skill")) {
    const inlineImages = readme.match(/!\[[^\]]*\]\([^)]+\)/g) || [];
    if (inlineImages.length === 0) {
      results.push({ level: "warning", message: "README.md has no inline screenshots (![alt](path)). Visual context dramatically improves discoverability." });
    }
  }
  return results;
}

function lintSkillFrontmatter(cwd, manifest) {
  // Every app and skill must ship a SKILL.md so the tool is AI-discoverable
  // (apps are CLIs that Claude drives via their skill). Bootstraps are pure
  // dep aggregators and are exempt.
  if (manifest.type !== "skill" && manifest.type !== "app") return [];
  const results = [];
  // Accept both package layouts:
  //   flat:   <pkg>/SKILL.md
  //   nested: <pkg>/skills/<slug>/SKILL.md  (adompkg-link-skill's default
  //           source path — previously the linter forced flat while the link
  //           helper assumed nested, so no single layout satisfied both).
  const candidates = [path.join(cwd, "SKILL.md")];
  const skillsDir = path.join(cwd, "skills");
  if (fs.existsSync(skillsDir)) {
    for (const d of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (d.isDirectory()) candidates.push(path.join(skillsDir, d.name, "SKILL.md"));
    }
  }
  const skillPath = candidates.find((p) => fs.existsSync(p));
  if (!skillPath) {
    const noun = manifest.type === "app" ? "app" : "skill";
    results.push({ level: "error", message: `${noun} packages must include a SKILL.md (Claude Code agent definition) at the package root or skills/<slug>/SKILL.md.` });
    return results;
  }
  const content = fs.readFileSync(skillPath, "utf8");
  if (!content.startsWith("---")) {
    results.push({ level: "error", message: "SKILL.md must start with YAML frontmatter (---name:--description:---)." });
    return results;
  }
  const fmEnd = content.indexOf("\n---", 4);
  if (fmEnd === -1) {
    results.push({ level: "error", message: "SKILL.md frontmatter not closed (missing terminating ---)." });
    return results;
  }
  const fm = content.slice(0, fmEnd);
  if (!/^name:\s*\S/m.test(fm)) {
    results.push({ level: "error", message: "SKILL.md frontmatter must declare a non-empty 'name:'." });
  }
  if (!/^description:\s*\S/m.test(fm)) {
    results.push({ level: "error", message: "SKILL.md frontmatter must declare a non-empty 'description:' (this is what Claude uses to decide when to invoke the skill)." });
  }
  return results;
}

function lintSecrets(cwd, manifest) {
  const results = [];
  const files = collectFiles(cwd, manifest);
  for (const rel of files) {
    // Filename-scope checks first — fast, no I/O.
    for (const pat of SECRET_PATTERNS) {
      if (pat.scope !== "path") continue;
      if (pat.re.test(rel)) {
        results.push({ level: "error", message: `${pat.name} detected in ${rel}. Move it outside the publish tree or add to .adomignore.` });
      }
    }
    // Content scan — only on text files under 1 MiB.
    const abs = path.join(cwd, rel);
    let stat;
    try { stat = fs.statSync(abs); } catch { continue; }
    if (!stat.isFile() || stat.size > 1024 * 1024) continue;
    let text;
    try { text = fs.readFileSync(abs, "utf8"); } catch { continue; }
    // Skip files that look binary (null bytes in first 4 KiB).
    if (/\x00/.test(text.slice(0, 4096))) continue;
    for (const pat of SECRET_PATTERNS) {
      if (pat.scope !== "content") continue;
      if (pat.re.test(text)) {
        results.push({ level: "error", message: `${pat.name} pattern detected in ${rel}. Rotate the secret and remove it from this file before publishing.` });
      }
    }
  }
  return results;
}

function lintVersionSync(cwd, manifest) {
  if (manifest.type !== "skill") return [];
  const skillPath = path.join(cwd, "SKILL.md");
  if (!fs.existsSync(skillPath)) return [];
  const content = fs.readFileSync(skillPath, "utf8");
  const m = content.match(/^version:\s*['"]?([^'"\s]+)['"]?\s*$/m);
  if (!m) return [];
  if (m[1] !== manifest.version) {
    return [{ level: "warning", message: `SKILL.md version (${m[1]}) doesn't match package.json version (${manifest.version}). Bump them together.` }];
  }
  return [];
}

// ------------------------------------------------------------
// Symlink-convention lint.
//
// The Adom convention is: install.sh leaves the canonical files in
// ~/project/adom_modules/<slug>/ (where the tarball was extracted) and
// every downstream install target — binaries on PATH, skill files in
// ~/.claude/skills/, etc. — is a SYMLINK back into the modules dir.
// That way the AI / user only ever needs to know one path per package;
// edits in the modules dir propagate immediately; reinstalls don't blow
// away in-place changes; and `adompkg link` can swap the trunk in one step.
//
// The lint rule scans install.sh for cp / install / rsync lines whose
// destination looks like a standard PATH or skill dir, and errors if the
// nearby code doesn't also use `ln -s`. Heuristic, but it catches the
// common case where authors default to `cp` and never link.
// ------------------------------------------------------------

// Destination-path fragments that should generally be reached via symlinks,
// not copies. Authors who want a real copy in one of these locations (e.g.
// an immutable shipped asset) can still write `ln -s` alongside the `cp` to
// silence the lint.
const SYMLINK_TARGET_FRAGMENTS = [
  "/.local/bin/",
  "/usr/local/bin/",
  "/.claude/skills/",
  "/.adom/skills/",
];

function lintSymlinkConvention(cwd, manifest) {
  if (manifest.type === "bootstrap") return [];
  const installPath = path.join(cwd, "install.sh");
  if (!fs.existsSync(installPath)) return [];
  let body;
  try { body = fs.readFileSync(installPath, "utf8"); } catch { return []; }
  const lines = body.split("\n");
  const hits = [];
  const usesSymlink = /\bln\s+-s/.test(body);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("#")) continue;
    // Match cp / install -m / rsync writes.
    if (!/\b(cp|install\s+-m|rsync)\b/.test(line)) continue;
    const hitsTarget = SYMLINK_TARGET_FRAGMENTS.some(frag => line.includes(frag));
    if (!hitsTarget) continue;
    if (usesSymlink && /\bln\s+-s/.test(lines[Math.max(0, i - 3)] + "\n" + lines[i] + "\n" + (lines[i + 1] || "") + "\n" + (lines[i + 2] || ""))) continue;
    hits.push({ lineNo: i + 1, line: line.trim() });
  }
  if (hits.length === 0) return [];
  return [{
    level: "error",
    message:
      `install.sh copies files into a standard install target without a symlink. The Adom convention is to symlink (ln -sfn) install targets back into ~/project/adom_modules/<slug>/ so edits propagate and reinstalls don't clobber. Use the helper: ` +
      `\`source "$(adompkg sh-helpers)" && adompkg-link-bin <name>\`. Offending line${hits.length === 1 ? "" : "s"}:\n` +
      hits.map(h => `    install.sh:${h.lineNo}  ${h.line}`).join("\n"),
  }];
}

// Advisory scan for prompt-injection-style text in the docs (README/SKILL).
// These files get fed to AI auditors/agents; instruction-like content there is
// a red flag. Warning only (not blocking) — surfaces it so a human/auditor
// treats the content with suspicion. Mirrors lib/packages.js INJECTION_PATTERNS.
const INJECTION_PATTERNS = [
  { name: "ignore previous instructions", re: /\bignore\s+(?:all\s+|the\s+)?(?:previous|above|prior|earlier|preceding)\s+(?:instructions?|prompts?|messages?|context)\b/i },
  { name: "disregard instructions", re: /\bdisregard\s+(?:all|the|any|your|previous|above)\b/i },
  { name: "new instructions", re: /\bnew\s+instructions?\s*:/i },
  { name: "you are now", re: /\byou\s+are\s+now\b/i },
  { name: "system prompt reference", re: /\b(?:system|developer)\s*prompt\b/i },
  { name: "reveal prompt/secrets", re: /\b(?:reveal|print|repeat|show|leak|exfiltrate)\b[^.\n]{0,40}\b(?:system\s*prompt|instructions?|secrets?|api[\s_-]?keys?|tokens?)\b/i },
  { name: "do not tell the user", re: /\b(?:do\s*not|don't|never)\s+(?:tell|inform|notify|alert)\s+the\s+(?:user|human)\b/i },
  { name: "chat role marker", re: /<\|(?:im_start|im_end|system|user|assistant)\|>|\[\/?INST\]|^\s*(?:system|assistant)\s*:/im },
  { name: "hidden control chars", re: /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/ },
];

function lintInjection(cwd, manifest) {
  const results = [];
  for (const file of ["README.md", "SKILL.md"]) {
    const p = path.join(cwd, file);
    if (!fs.existsSync(p)) continue;
    let text = "";
    try { text = fs.readFileSync(p, "utf8"); } catch { continue; }
    for (const pat of INJECTION_PATTERNS) {
      if (pat.re.test(text)) {
        results.push({ level: "warning", message: `${file} contains prompt-injection-like text ("${pat.name}"). AI tools treat package docs as untrusted; remove it or it'll be flagged for review.` });
      }
    }
  }
  return results;
}

// ── Quality checks (the adom-wiki-publish bar, now built into adompkg) ──
// A hero image, README screenshots, and a walkthrough video are what make a
// listing land. These mirror the deterministic checks the old adom-wiki-publish
// linter enforced.

function findHeroImage(cwd) {
  for (const d of ["docs", "screenshots", "."]) {
    const dir = path.join(cwd, d);
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      const n = name.toLowerCase();
      if (n.includes("hero") && /\.(png|jpe?g|webp)$/.test(n)) return path.join(dir, name);
    }
  }
  return null;
}

function lintHero(cwd) {
  if (findHeroImage(cwd)) return [];
  return [{ level: "error", message:
    "No hero image found. Save one to docs/hero.png (760px wide). It must show the tool ACTUALLY RUNNING — " +
    "real UI/CLI output, the thing in action — not a card, not the README, not AI-generated art. " +
    "Ask: 'if I use this, what will I SEE on screen?' Screenshot THAT (Hydrogen webview screenshot or adom-desktop)." }];
}

function lintReadmeImages(cwd) {
  const p = path.join(cwd, "README.md");
  if (!fs.existsSync(p)) return [];
  const readme = fs.readFileSync(p, "utf8");
  const imgs = (readme.match(/!\[/g) || []).length + (readme.match(/<img/g) || []).length;
  if (imgs >= 2) return [];
  return [{ level: "warning", message:
    `README has only ${imgs} inline image(s) — humans need visuals. Add 2+ screenshots of the tool in action ` +
    "(empty/loaded/error states), captured via pup or a Hydrogen webview screenshot, sized to 760px." }];
}

function lintReadmeVideo(cwd) {
  const p = path.join(cwd, "README.md");
  if (!fs.existsSync(p)) return [];
  const readme = fs.readFileSync(p, "utf8");
  if (/<video|\.webm|\.mp4|youtube|vimeo|<iframe/.test(readme)) return [];
  return [{ level: "warning", message:
    "README has no video — a video is worth 100,000 words. Use the demo-recording skill to produce a " +
    "walkthrough with voiceover + chapters, then embed it." }];
}

// Tags drive search + discovery. Apps, skills, and components are effectively
// unfindable without them, so require at least one (bootstraps are exempt —
// they're meta-packages installed by name, not searched for).
function lintTags(manifest) {
  if (manifest.type === "bootstrap") return [];
  const tags = Array.isArray(manifest.tags) ? manifest.tags.filter(t => typeof t === "string" && t.trim()) : [];
  if (tags.length > 0) return [];
  return [{ level: "error", message:
    "No tags set. Add a 'tags' array to package.json (e.g. [\"cli\", \"pcb\"]) — apps, skills, and components " +
    "are unfindable in search without them." }];
}

function lintBundle(cwd, manifest) {
  const skillsDir = path.join(cwd, "skills");
  let subs = [];
  try { subs = fs.readdirSync(skillsDir).filter(n => fs.existsSync(path.join(skillsDir, n, "SKILL.md"))); } catch { return []; }
  if (subs.length === 0) return [];
  const results = [];
  const readmePath = path.join(cwd, "README.md");
  const readme = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, "utf8") : "";
  const missingDoc = subs.filter(n => !readme.includes(n));
  if (missingDoc.length) results.push({ level: "warning", message: `README doesn't list bundle sub-skill(s): ${missingDoc.join(", ")}.` });
  const installPath = path.join(cwd, "install.sh");
  if (fs.existsSync(installPath)) {
    const sh = fs.readFileSync(installPath, "utf8");
    const missingInstall = subs.filter(n => !sh.includes(n));
    if (missingInstall.length) results.push({ level: "error", message: `install.sh doesn't handle bundle sub-skill(s): ${missingInstall.join(", ")}. It must copy every sub-skill to ~/.claude/skills/<name>/.` });
  }
  return results;
}

// Component pages get inline symbol/footprint/3D viewers on the wiki, driven
// by the part files next to page.json. Missing symbol/footprint warn
// (advisory); a component with NO 3D source at all (neither .glb nor
// .step/.stp) is an error that blocks the publish — every component must
// ship a 3D model so the library never fills with model-less pages.
function lintComponentParts(cwd, manifest) {
  if (manifest.type !== "component") return [];
  const results = [];
  // Scan the same file set publish would collect (recursive, honors the
  // `files` whitelist) — a top-level readdir misses parts in subdirectories
  // like assets/ (audit F-PI7).
  let collected;
  try { collected = collectFiles(cwd, manifest); } catch { collected = []; }
  const anyFile = (ext) => collected.some(f => f.toLowerCase().endsWith(ext));
  const parts = (manifest.component && manifest.component.parts) || {};
  const have = (key, exts) =>
    (typeof parts[key] === "string" && parts[key]) || exts.some(anyFile);
  if (!have("symbol", [".kicad_sym"])) {
    results.push({ level: "warning", message: "component has no schematic symbol (.kicad_sym) — the wiki page won't show the symbol viewer." });
  }
  if (!have("footprint", [".kicad_mod"])) {
    results.push({ level: "warning", message: "component has no PCB footprint (.kicad_mod) — the wiki page won't show the footprint viewer." });
  }
  if (!have("model_3d", [".glb"])) {
    const hasStep = anyFile(".step") || anyFile(".stp");
    if (hasStep) {
      // A STEP is a valid 3D source — publish auto-converts it to GLB before
      // lint runs, so reaching here means conversion failed or --no-glb was
      // passed. Warn, don't block: the page still ships a 3D source.
      results.push({ level: "warning", message: "component has a STEP model but no .glb — the wiki 3D viewer needs GLB. Publish auto-converts via step2glb; this warning means conversion failed or --no-glb was passed." });
    } else {
      results.push({ level: "error", message: "component has no 3D source (.glb or .step/.stp) — components must ship a 3D model. Add a STEP or GLB file (publish auto-converts STEP to GLB via step2glb)." });
    }
  }
  return results;
}

// ------------------------------------------------------------
// STEP → GLB conversion (components).
//
// The wiki's 3D viewer renders GLB; CAD exports ship STEP. When a component
// has a .step/.stp but no .glb, publish converts it via the shared
// service-step2glb container so the page gets a working 3D viewer.
//
// The service wants the RAW STEP body (multipart breaks its parser) plus
// X-Client / X-Job-Name headers, and runs async: POST /convert → job id,
// poll /jobs/:id, fetch /jobs/:id/result. ISO 10303-21 comments are legal
// and normally convert fine; if the service's CAD kernel still rejects the
// file with a parse error, we retry once with /* ... */ comments stripped.
// ------------------------------------------------------------

const STEP2GLB_API = (process.env.STEP2GLB_SERVICE_API || "https://step2glb-gmdoncpxdwx0.adom.cloud").replace(/\/$/, "");
const STEP2GLB_POLL_MS = 2000;
const STEP2GLB_TIMEOUT_MS = 240000;

// Among the files a component publish would push, find the .step/.stp to
// convert — only when no .glb exists anywhere in the set. Mirrors the
// indexer's first-match convention.
function findStepNeedingGlb(cwd, manifest) {
  const files = collectFiles(cwd, manifest);
  if (files.some(f => f.toLowerCase().endsWith(".glb"))) return null;
  return files.find(f => /\.(step|stp)$/i.test(f)) || null;
}

// Strip ISO 10303-21 /* ... */ comments. Used ONLY on the retry path after a
// parse failure — a naive strip could theoretically touch a quoted string
// containing "/*", so the pristine bytes are always tried first and the repo
// file is never modified.
function stripStepComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

async function step2glbRequest(urlPath, opts = {}) {
  const headers = {
    "X-Client": `adompkg/${(() => { try { return os.userInfo().username; } catch { return "unknown"; } })()}`,
    ...(opts.headers || {}),
  };
  let res;
  try {
    res = await fetch(`${STEP2GLB_API}${urlPath}`, { ...opts, headers });
  } catch (err) {
    throw new Error(describeFetchError(err, `${STEP2GLB_API}${urlPath}`));
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`step2glb ${urlPath}: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  return res;
}

async function step2glbConvert(body, jobName) {
  const submit = await step2glbRequest("/convert", {
    method: "POST",
    headers: { "X-Job-Name": jobName, "Content-Type": "application/step" },
    body,
  });
  const job = await submit.json();
  if (!job.job_id) throw new Error(`step2glb did not return a job id: ${JSON.stringify(job).slice(0, 200)}`);

  const deadline = Date.now() + STEP2GLB_TIMEOUT_MS;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`step2glb conversion timed out after ${STEP2GLB_TIMEOUT_MS / 1000}s (job ${job.job_id})`);
    await new Promise(r => setTimeout(r, STEP2GLB_POLL_MS));
    const poll = await step2glbRequest(`/jobs/${job.job_id}`, { headers: { "X-Job-Name": jobName } });
    const status = await poll.json();
    if (status.status === "complete" || status.status === "done") break;
    if (status.status === "failed") {
      // Strip ANSI escapes the service embeds in its error text.
      const msg = String(status.error || "unknown error").replace(/\[[0-9;]*m/g, "").slice(0, 300);
      const err = new Error(`step2glb conversion failed: ${msg}`);
      err.isParseError = /StepFile|RetFail|Incorrect syntax|Undefined Parsing/i.test(msg);
      throw err;
    }
  }
  const result = await step2glbRequest(`/jobs/${job.job_id}/result`, { headers: { "X-Job-Name": jobName } });
  const glb = Buffer.from(await result.arrayBuffer());
  if (glb.length < 12 || glb.toString("latin1", 0, 4) !== "glTF") {
    throw new Error("step2glb returned data that is not a GLB");
  }
  return glb;
}

// Convert the component's STEP to a GLB next to it. Returns the written
// relative path, or null when there's nothing to do.
async function ensureComponentGlb(cwd, manifest) {
  const stepRel = findStepNeedingGlb(cwd, manifest);
  if (!stepRel) return null;
  const raw = fs.readFileSync(path.join(cwd, stepRel));
  const outRel = stepRel.replace(/\.(step|stp)$/i, ".glb");
  process.stdout.write(`Converting ${stepRel} → ${outRel} via step2glb...\n`);
  let glb;
  try {
    glb = await step2glbConvert(raw, `${manifest.slug}-glb`);
  } catch (err) {
    if (!err.isParseError) throw err;
    process.stdout.write("  parse error from the CAD kernel — retrying with ISO comments stripped...\n");
    glb = await step2glbConvert(Buffer.from(stripStepComments(raw.toString("utf8")), "utf8"), `${manifest.slug}-glb-retry`);
  }
  fs.writeFileSync(path.join(cwd, outRel), glb);
  process.stdout.write(`  wrote ${outRel} (${(glb.length / 1024).toFixed(0)} KiB)\n`);
  if (glb.length > 50 * 1024 * 1024) {
    process.stdout.write(`  WARNING: ${outRel} exceeds the 50 MiB page-repo push limit — the wiki won't receive it until that limit is raised.\n`);
  }
  return outRel;
}

function runPrePublishLint(cwd, manifest) {
  return [
    ...lintReadme(cwd, manifest),
    ...lintSkillFrontmatter(cwd, manifest),
    ...lintVersionSync(cwd, manifest),
    ...lintSecrets(cwd, manifest),
    ...lintSymlinkConvention(cwd, manifest),
    ...lintInjection(cwd, manifest),
    ...lintTags(manifest),
    // Components are exempt from hero/screenshot/video rules: the wiki
    // renders their visuals (symbol/footprint/3D viewers) from part files.
    ...(manifest.type === "component" ? [] : [
      ...lintHero(cwd),
      ...lintReadmeImages(cwd),
      ...lintReadmeVideo(cwd),
    ]),
    ...lintBundle(cwd, manifest),
    ...lintComponentParts(cwd, manifest),
  ];
}

async function cmdPublish(args) {
  // Require auth up front for a clean error before we build a tarball.
  if (!getToken()) {
    die("not logged in. /var/run/adom/api-key should be picked up automatically. Set ADOMPKG_TOKEN to override.");
  }

  const cwd = process.cwd();
  const { manifest, file } = readManifestFromCwd(cwd);
  process.stdout.write(`Publishing from ${file} in ${cwd}\n`);

  let rest = args;
  const verRes = pickFlag(rest, "--version"); rest = verRes.rest;
  if (verRes.value) manifest.version = verRes.value;
  const orgRes = pickFlag(rest, "--org"); rest = orgRes.rest;
  const orgFlagSupplied = orgRes.value != null;
  let orgArg = orgRes.value || DEFAULT_ORG || null;
  const tagRes = pickFlag(rest, "--tag"); rest = tagRes.rest;
  const tag = tagRes.value || null;
  // Source push is OPT-IN (--source). The registry now extracts README.md
  // from the tarball server-side for the Overview, and we don't browse other
  // tarball files in the wiki, so the git-repo push is only useful if you
  // specifically want a browsable source tree. --no-source still accepted
  // (no-op) for back-compat.
  const sourceRes = pickBoolFlag(rest, "--source"); rest = sourceRes.rest;
  const noSourceRes = pickBoolFlag(rest, "--no-source"); rest = noSourceRes.rest;
  const pushSource = sourceRes.value && !noSourceRes.value;
  // --no-glb skips the automatic STEP→GLB conversion for components.
  const noGlbRes = pickBoolFlag(rest, "--no-glb"); rest = noGlbRes.rest;
  // --yes / -y suppresses the interactive prompts (CI-friendly).
  const yesLong = pickBoolFlag(rest, "--yes"); rest = yesLong.rest;
  const yesShort = pickBoolFlag(rest, "-y"); rest = yesShort.rest;
  const assumeYes = yesLong.value || yesShort.value;
  // --private / --public set the page's visibility (only respected on first
  // publish — once a page exists, visibility is managed via the wiki). When
  // neither is passed, the manifest's `visibility` field wins; otherwise
  // default to public.
  const privRes = pickBoolFlag(rest, "--private"); rest = privRes.rest;
  const pubRes = pickBoolFlag(rest, "--public"); rest = pubRes.rest;
  const visFlagSupplied = privRes.value || pubRes.value;
  if (privRes.value && pubRes.value) {
    die("--private and --public are mutually exclusive.", EXIT_USAGE);
  }
  if (privRes.value) manifest.visibility = "private";
  else if (pubRes.value) manifest.visibility = "public";

  // Interactive prompts (TTY only, not suppressed by --yes, only for the
  // dimensions whose flag wasn't already supplied). This keeps CI and the
  // test suite non-interactive: no stdin.isTTY, no --org/--public/--private
  // flag, or --yes all skip prompting and fall back to flag-based behavior.
  const canPrompt = process.stdin.isTTY && !assumeYes;

  // Prompt 1 — "Publish as": choose the owner (your account or an org).
  if (canPrompt && !orgFlagSupplied) {
    try {
      const data = await httpJson(`${REGISTRY}/api/v1/me/orgs`);
      const username = data?.user?.username || "you";
      const orgs = Array.isArray(data?.orgs) ? data.orgs : [];
      process.stdout.write(`Publish as:\n`);
      process.stdout.write(`  0) ${username} (your account)\n`);
      orgs.forEach((o, i) => process.stdout.write(`  ${i + 1}) ${o.name}\n`));
      const ans = (await promptLine("Publish as [0]: ")).trim();
      const idx = ans === "" ? 0 : parseInt(ans, 10);
      if (Number.isInteger(idx) && idx >= 1 && idx <= orgs.length) {
        // Picked an org -> publish under that org as owner.
        orgArg = orgs[idx - 1].name;
      }
      // idx === 0 (or invalid) -> own account: leave orgArg null.
    } catch (err) {
      // Couldn't reach the orgs endpoint — fall back silently to own account.
      process.stdout.write(`${dim(`(could not fetch orgs: ${err.message}; publishing under your account)`)}\n`);
    }
  }

  // Prompt 2 — visibility.
  if (canPrompt && !visFlagSupplied) {
    const ans = (await promptLine("Visibility — (1) public  (2) private [1]: ")).trim();
    manifest.visibility = ans === "2" ? "private" : "public";
  }

  if (orgArg) manifest.org = orgArg;
  if (tag) manifest.tag = tag;

  const errs = validateLocal(manifest, cwd);
  if (errs.length > 0) {
    process.stderr.write("Local validation failed:\n");
    for (const e of errs) process.stderr.write(`  - ${e}\n`);
    process.exit(EXIT_USAGE);
  }

  // Components: generate the web-viewable 3D model BEFORE lint, so the page
  // gets a 3D viewer (the wiki renders GLB, not STEP) and the missing-glb
  // lint stays quiet when conversion succeeds. Failure warns and continues —
  // a missing 3D model shouldn't block a publish.
  if (manifest.type === "component" && !noGlbRes.value) {
    try {
      await ensureComponentGlb(cwd, manifest);
    } catch (err) {
      process.stderr.write(`Warning: STEP→GLB conversion failed: ${err.message}\n`);
      process.stderr.write(`         The page will have no 3D viewer until a .glb is published. Re-run, or use --no-glb to silence.\n`);
    }
  }

  // Always-on pre-publish lint. Errors abort; warnings print and let the
  // publish through. The set of checks is deliberately small and universal —
  // anything Adom-specific (no MCP, no kicad-cli, etc.) belongs in the
  // standalone adom-publish-linter that runs alongside, not here.
  const lintResults = runPrePublishLint(cwd, manifest);
  const lintErrors = lintResults.filter(r => r.level === "error");
  const lintWarnings = lintResults.filter(r => r.level === "warning");
  if (lintWarnings.length > 0) {
    process.stdout.write(`${yel("Lint warnings:")}\n`);
    for (const w of lintWarnings) process.stdout.write(`  - ${w.message}\n`);
    process.stdout.write("\n");
  }
  if (lintErrors.length > 0) {
    process.stderr.write(`${red("Lint failed (publish blocked):")}\n`);
    for (const e of lintErrors) process.stderr.write(`  - ${e.message}\n`);
    process.exit(EXIT_USAGE);
  }

  // prepublish lifecycle hook — runs in cwd as the first author-controlled
  // step, BEFORE any network or tarball build. Authors use this to generate
  // dist artifacts, regenerate manifests, etc. (npm-shaped: matches
  // `npm prepublish` ordering — runs before any registry interaction.)
  // Non-zero exit aborts. The hook script must live inside the project dir.
  const prepublishScript = manifest.scripts && manifest.scripts.prepublish;
  if (prepublishScript) {
    const hookPath = path.resolve(cwd, prepublishScript.replace(/^\.\//, ""));
    if (!hookPath.startsWith(cwd)) {
      die(`scripts.prepublish path '${prepublishScript}' escapes the project directory.`, EXIT_USAGE);
    }
    if (!fs.existsSync(hookPath)) {
      die(`scripts.prepublish points at '${prepublishScript}' but the file is missing.`, EXIT_USAGE);
    }
    process.stdout.write(`Running prepublish (${prepublishScript})...\n`);
    try {
      runScript(hookPath, cwd, false);
    } catch (err) {
      die(`prepublish failed: ${err.message}`);
    }
  }

  // Pre-flight: refuse to downgrade — but per PLATFORM, so an independent
  // stream is fine (linux@1.3.0 is allowed even when windows is already 1.4.0).
  // The server enforces the same; this saves a round-trip with a friendly msg.
  try {
    const plat = (manifest.platform || "any").toLowerCase();
    const qs = orgArg ? `?org=${encodeURIComponent(orgArg)}` : "";
    const data = await httpJson(`${REGISTRY}/api/v1/packages/${manifest.slug}/versions${qs}`);
    let newest = null;
    for (const v of (data.versions || [])) {
      if ((v.platform || "any") !== plat) continue;
      if (!newest || cmpSemver(v.version, newest) > 0) newest = v.version;
    }
    if (newest && cmpSemver(manifest.version, newest) < 0) {
      die(`refusing to publish ${manifest.slug}@${manifest.version} (${plat}): newer ${plat} version ${newest} already published. Use 'adompkg version <bump>' to pick a newer version.`);
    }
  } catch (err) {
    // 404 here = first publish for this slug, that's fine.
    if (!err.status || err.status !== 404) {
      if (err.network) die(err.message);
      // Otherwise keep going — server will still validate.
    }
  }

  const { tarPath } = buildTarball(cwd, manifest.slug, manifest.version, manifest);
  const tarBytes = fs.readFileSync(tarPath);
  if (tarBytes.length === 0) {
    die(`refusing to publish: built tarball is empty. Check your install.sh/files list and try again.`);
  }
  process.stdout.write(`Built tarball (${tarBytes.length} bytes, sha256 ${sha256File(tarPath)})\n`);

  const fd = new FormData();
  fd.append("manifest", JSON.stringify(manifest));
  if (tag) fd.append("tag", tag);
  const blob = new Blob([tarBytes], { type: "application/gzip" });
  fd.append("tarball", blob, `${manifest.slug}-${manifest.version}.tgz`);

  const url = `${REGISTRY}/api/v1/packages/${manifest.slug}/publish`;
  const headers = authHeaders();
  process.stdout.write(`POST ${url}${orgArg ? ` (org=${orgArg})` : ""}${tag ? ` (tag=${tag})` : ""}\n`);
  let res;
  try {
    res = await fetch(url, { method: "POST", body: fd, headers });
  } catch (err) {
    die(describeFetchError(err, url));
  }
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = { error: text }; }

  if (!res.ok) {
    process.stderr.write(`Publish failed: HTTP ${res.status}\n`);
    if (body.errors) for (const e of body.errors) process.stderr.write(`  - ${e}\n`);
    else if (body.error) process.stderr.write(`  ${body.error}\n`);
    // The wiki lints server-side and blocks on a detected secret (HTTP 400).
    if (body.detail) process.stderr.write(`  ${body.detail}\n`);
    if (body.hint) process.stderr.write(`  Hint: ${body.hint}\n`);
    if (res.status === 401) {
      process.stderr.write(`Hint: your token is invalid or expired. Set a fresh ADOMPKG_TOKEN (or refresh the container API key).\n`);
    }
    if (res.status === 409) {
      process.stderr.write(`Hint: ${manifest.slug}@${manifest.version} is already published. Run 'adompkg version patch' to bump, then retry.\n`);
    }
    if (res.status === 429) {
      const retry = res.headers.get("retry-after");
      process.stderr.write(`Hint: you are publishing too quickly. Wait${retry ? ` ${retry}s` : " a moment"} and try again.\n`);
    }
    process.exit(EXIT_ERR);
  }
  // Determine the package owner so we can print owner-scoped URLs. The server
  // may echo it back (owner / name="<owner>/<slug>"); else fall back to the
  // org we published under. When unknown, use the legacy bare-slug routes.
  const knownOwner = body.owner
    || (typeof body.name === "string" && body.name.includes("/") ? body.name.split("/")[0] : null)
    || orgArg
    || null;
  const id = knownOwner ? `${knownOwner}/${manifest.slug}` : manifest.slug;
  const seg = knownOwner
    ? `${encodeURIComponent(knownOwner)}/${encodeURIComponent(manifest.slug)}`
    : encodeURIComponent(manifest.slug);
  process.stdout.write(`Published ${id}@${manifest.version}${tag ? ` (tag ${tag})` : ""}\n`);
  process.stdout.write(`Manifest URL: ${REGISTRY}/api/v1/packages/${seg}/${manifest.version}/manifest\n`);
  process.stdout.write(`Tarball URL:  ${REGISTRY}/api/v1/packages/${seg}/${manifest.version}/tarball\n`);
  process.stdout.write(`Wiki page:    ${REGISTRY}/${seg}\n`);

  // Surface the server's post-publish diagnostics (private? no hero? no
  // discovery triggers?) so the agent/human doesn't think a private or
  // unsurfaced package "shipped" and stop. (AI-hint audit — CLI H1.)
  if (Array.isArray(body.hints) && body.hints.length) {
    process.stdout.write("\n");
    for (const h of body.hints) {
      const lvl = h.level === "warning" ? yel("WARNING") : "note";
      process.stdout.write(`${lvl}: ${h.message}${h.action ? `\n        ${h.action}` : ""}\n`);
    }
  }

  if (pushSource) {
    try {
      await pushSourceToWikiRepo(cwd, manifest);
    } catch (err) {
      // Don't fail the publish over a source-push problem — the tarball is
      // already up. Surface a clear hint instead.
      process.stderr.write(`Warning: failed to push source to wiki page: ${err.message}\n`);
      process.stderr.write(`         Re-run with 'adompkg publish --no-source' to skip, or fix the issue and call POST /api/v1/pages/${manifest.slug}/files manually.\n`);
    }
  } else if (manifest.type === "component" && !noSourceRes.value) {
    // Component part files (symbol, footprint, 3D model, datasheet) live in
    // the page git repo — the wiki's inline viewers, blob links, and Files
    // grid all read from there. Push them by default; --no-source opts out.
    try {
      await pushComponentPartsToWikiRepo(cwd, manifest);
    } catch (err) {
      process.stderr.write(`Warning: failed to push component part files to wiki page: ${err.message}\n`);
      process.stderr.write(`         The page will have no symbol/footprint/3D viewers until files are pushed.\n`);
    }
  }

  // Bundle downloadable release assets declared in package.json
  // ("assets": ["dist/app.exe", ...]) into the Releases store — raw binaries
  // kept OUT of git, served direct (no untar). Non-fatal: the package is up.
  if (Array.isArray(manifest.assets) && manifest.assets.length) {
    try {
      const uploaded = await uploadReleaseAssets(seg, manifest.version, manifest.assets, { cwd });
      if (uploaded.length) {
        process.stdout.write(`Release assets:\n`);
        for (const a of uploaded) process.stdout.write(`  ${a.filename} (${a.platform}, ${(a.size / 1048576).toFixed(1)} MB)  ${REGISTRY}${a.download_url}\n`);
      }
    } catch (err) {
      process.stderr.write(`Warning: failed to upload release assets: ${err.message}\n`);
    }
  }
}

// ------------------------------------------------------------
// Source push to the wiki page git repo.
//
// adompkg publish historically only uploaded a tarball, leaving the wiki
// page's Files tab nearly empty (just metadata) and breaking README inline
// screenshots. This pushes the same set of files we tarballed to the page's
// git repo so the Files tab reflects the source. Bug #1 footgun from May 2026
// user feedback.
// ------------------------------------------------------------

// Extensions we always treat as binary. Anything else is sniffed by content.
const BINARY_EXTS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "tiff",
  "pdf",
  "mp4", "mov", "avi", "webm", "mkv",
  "mp3", "wav", "ogg", "m4a", "flac",
  "zip", "tar", "tgz", "tar.gz", "gz", "bz2", "7z", "rar",
  "exe", "dll", "so", "dylib", "dmg", "deb", "rpm",
  "glb", "gltf", "step", "stp", "stl", "wasm",
  "ttf", "otf", "woff", "woff2", "eot",
  "node", "bin",
]);

function isBinaryContent(buf) {
  // Look for NUL bytes in the first 8 KiB — the same heuristic git uses.
  const len = Math.min(buf.length, 8192);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

function looksBinary(relPath, buf) {
  const ext = relPath.split(".").pop().toLowerCase();
  if (BINARY_EXTS.has(ext)) return true;
  return isBinaryContent(buf);
}

async function pushSourceToWikiRepo(cwd, manifest) {
  return pushFilesToWikiRepo(cwd, manifest, collectFiles(cwd, manifest));
}

// EDA part files a component page repo should carry for the wiki's inline
// symbol/footprint/3D viewers and download cards.
const COMPONENT_PART_EXTS = [".kicad_sym", ".kicad_mod", ".glb", ".step", ".stp", ".pdf", ".lbr", ".svg", ".png"];

async function pushComponentPartsToWikiRepo(cwd, manifest) {
  const picked = new Set();
  const parts = (manifest.component && manifest.component.parts) || {};
  for (const v of Object.values(parts)) {
    if (typeof v === "string" && v && fs.existsSync(path.join(cwd, v))) {
      picked.add(v.replace(/\\/g, "/"));
    }
  }
  for (const rel of collectFiles(cwd, manifest)) {
    const lower = rel.toLowerCase();
    if (COMPONENT_PART_EXTS.some(ext => lower.endsWith(ext))) picked.add(rel);
  }
  return pushFilesToWikiRepo(cwd, manifest, [...picked]);
}

// Per-file ceiling for the page-repo push (audit G5: raised 5 → 50 MiB so
// real-world GLB/STEP models fit). Anything larger belongs in releases /
// object storage, not the page git repo.
const PUSH_FILE_SIZE_LIMIT = 50 * 1024 * 1024;

// Build the multipart/form-data body for the page-files push. Multipart
// instead of base64-in-JSON because the server caps JSON bodies at 4 MiB and
// base64 inflates payloads ~33% — large binaries only fit through the
// server's multipart path (100 MiB cap), which is also binary-safe. Each
// file's repo-relative path rides in the part's filename: the server's
// parser and git commit layer both preserve subdirectory paths verbatim.
// Returns { form, count, skipped: [{path, size}] }.
function buildWikiPushForm(cwd, manifest, files) {
  const form = new FormData();
  form.append("message", `Publish ${manifest.slug}@${manifest.version}`);
  let count = 0;
  const skipped = [];
  for (const rel of files) {
    const abs = path.join(cwd, rel);
    let stat;
    try { stat = fs.statSync(abs); } catch { continue; }
    if (!stat.isFile()) continue;
    if (stat.size > PUSH_FILE_SIZE_LIMIT) {
      skipped.push({ path: rel, size: stat.size });
      continue;
    }
    form.append("files", new Blob([fs.readFileSync(abs)]), rel);
    count++;
  }
  return { form, count, skipped };
}

async function pushFilesToWikiRepo(cwd, manifest, files) {
  if (files.length === 0) return;

  const { form, count, skipped } = buildWikiPushForm(cwd, manifest, files);
  for (const s of skipped) {
    process.stdout.write(`  WARNING: skipped ${s.path} (${(s.size / (1024 * 1024)).toFixed(1)} MiB exceeds the ${PUSH_FILE_SIZE_LIMIT / (1024 * 1024)} MiB per-file push limit) — host it elsewhere.\n`);
  }

  if (count === 0) return;

  const url = `${REGISTRY}/api/v1/pages/${manifest.slug}/files`;
  // No explicit Content-Type: fetch sets multipart/form-data with the boundary.
  const headers = authHeaders();

  process.stdout.write(`Pushing ${count} source file${count === 1 ? "" : "s"} to wiki page...\n`);
  let res;
  try {
    res = await fetch(url, { method: "POST", body: form, headers });
  } catch (err) {
    throw new Error(describeFetchError(err, url));
  }
  const text = await res.text();
  if (!res.ok) {
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = { error: text }; }
    if (res.status === 404) {
      throw new Error(`page ${manifest.slug} does not exist on the wiki yet. Create it first (POST /api/v1/pages) or visit ${REGISTRY}/pages/${manifest.slug}.`);
    }
    throw new Error(parsed.error || `HTTP ${res.status} ${res.statusText}`);
  }
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = {}; }
  const commit = parsed.commit ? ` (commit ${String(parsed.commit).slice(0, 8)})` : "";
  process.stdout.write(`Pushed ${count} file${count === 1 ? "" : "s"} to ${REGISTRY}/pages/${manifest.slug}${commit}\n`);
}

// ------------------------------------------------------------
// Semver helpers (shared by publish, version, view).
// ------------------------------------------------------------

// Conservative spec-satisfaction check for peer-dep filtering only. Handles
// caret (^X.Y.Z), tilde (~X.Y.Z), exact, *, latest. Anything more exotic
// returns false so the warning isn't suppressed — better to warn than to
// silently miss an incompatibility.
function satisfiesSpecLocal(version, spec) {
  if (!spec || spec === "*" || spec === "latest") return true;
  const v = parseSemver(version);
  if (!v) return false;
  const trimmed = String(spec).trim();
  if (/^\d/.test(trimmed)) {
    const s = parseSemver(trimmed);
    return !!s && v.major === s.major && v.minor === s.minor && v.patch === s.patch;
  }
  // Two-char comparison operators first (>=, <=).
  if (trimmed.startsWith(">=")) {
    const target = trimmed.slice(2);
    return cmpSemver(version, target) >= 0;
  }
  if (trimmed.startsWith("<=")) {
    const target = trimmed.slice(2);
    return cmpSemver(version, target) <= 0;
  }
  const op = trimmed[0];
  // One-char comparison operators.
  if (op === ">") return cmpSemver(version, trimmed.slice(1)) > 0;
  if (op === "<") return cmpSemver(version, trimmed.slice(1)) < 0;
  const rest = parseSemver(trimmed.slice(1));
  if (!rest) return false;
  if (op === "^") {
    if (rest.major > 0) {
      return v.major === rest.major && cmpSemver(version, trimmed.slice(1)) >= 0;
    }
    if (rest.minor > 0) {
      return v.major === 0 && v.minor === rest.minor && cmpSemver(version, trimmed.slice(1)) >= 0;
    }
    return v.major === 0 && v.minor === 0 && v.patch === rest.patch;
  }
  if (op === "~") {
    return v.major === rest.major && v.minor === rest.minor && cmpSemver(version, trimmed.slice(1)) >= 0;
  }
  if (op === "=") {
    return v.major === rest.major && v.minor === rest.minor && v.patch === rest.patch;
  }
  return false;
}

function filterPeerWarnings(warnings, installed) {
  return warnings.filter(w => {
    const inst = installed[w.peer];
    if (!inst) return true; // not installed locally → still a warning
    // Installed locally: check spec satisfaction. If satisfied, suppress.
    return !satisfiesSpecLocal(inst.version, w.spec);
  });
}

function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(v || "").trim());
  if (!m) return null;
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2], 10),
    patch: parseInt(m[3], 10),
    prerelease: m[4] || null,
    raw: v,
  };
}

// Compare dot-separated prerelease tags per semver §11: numeric identifiers
// compare numerically ("beta.9" < "beta.10"), numeric ranks below alphanumeric,
// and a larger set of fields wins when all else is equal ("beta" < "beta.1").
function cmpPrerelease(a, b) {
  const as = a.split("."), bs = b.split(".");
  const n = Math.max(as.length, bs.length);
  for (let i = 0; i < n; i++) {
    if (i >= as.length) return -1;
    if (i >= bs.length) return 1;
    const x = as[i], y = bs[i];
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn) { const d = parseInt(x, 10) - parseInt(y, 10); if (d !== 0) return d < 0 ? -1 : 1; }
    else if (xn !== yn) return xn ? -1 : 1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function cmpSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) {
    // fallback to string compare so we don't crash on weird versions.
    return String(a).localeCompare(String(b));
  }
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;
  if (pa.prerelease && !pb.prerelease) return -1; // 1.2.3-beta < 1.2.3
  if (!pa.prerelease && pb.prerelease) return 1;
  if (pa.prerelease && pb.prerelease) return cmpPrerelease(pa.prerelease, pb.prerelease);
  return 0;
}

function bumpSemver(current, kind) {
  const p = parseSemver(current);
  if (!p) throw new Error(`current version '${current}' is not valid semver`);
  // Explicit version (looks like a semver) -> use as-is.
  if (parseSemver(kind)) return kind;
  switch (kind) {
    case "patch":      return `${p.major}.${p.minor}.${p.patch + 1}`;
    case "minor":      return `${p.major}.${p.minor + 1}.0`;
    case "major":      return `${p.major + 1}.0.0`;
    case "premajor":   return `${p.major + 1}.0.0-beta.0`;
    case "preminor":   return `${p.major}.${p.minor + 1}.0-beta.0`;
    case "prepatch":   return `${p.major}.${p.minor}.${p.patch + 1}-beta.0`;
    case "prerelease": {
      if (p.prerelease) {
        // bump the trailing integer if present (beta.0 -> beta.1)
        const parts = p.prerelease.split(".");
        const last = parts[parts.length - 1];
        if (/^\d+$/.test(last)) {
          parts[parts.length - 1] = String(parseInt(last, 10) + 1);
        } else {
          parts.push("0");
        }
        return `${p.major}.${p.minor}.${p.patch}-${parts.join(".")}`;
      }
      return `${p.major}.${p.minor}.${p.patch + 1}-beta.0`;
    }
    default:
      throw new Error(`unknown version bump kind: '${kind}'. Use patch/minor/major/premajor/preminor/prepatch/prerelease or an explicit semver like 1.2.3.`);
  }
}

// ------------------------------------------------------------
// Search / info
// ------------------------------------------------------------

async function cmdSearch(args) {
  if (args.length === 0) usage("usage: adompkg search <query>");
  const q = args.join(" ");
  const url = `${REGISTRY}/api/v1/search?q=${encodeURIComponent(q)}`;
  const data = await httpJson(url);
  const rows = data.results || data.pages || [];
  if (rows.length === 0) { process.stdout.write("No results.\n"); return; }
  for (const r of rows) {
    process.stdout.write(`${bold(r.slug)}  ${r.type}  ${r.title || ""}\n`);
    if (r.brief) process.stdout.write(`  ${r.brief}\n`);
  }
}

async function cmdInfo(args) {
  const { value: orgArg, rest } = pickFlag(args, "--org");
  const org = orgArg || DEFAULT_ORG;
  if (rest.length === 0) usage("usage: adompkg info <owner>/<slug> [--org <slug>]");
  const ref = rest[0];
  const seg = pkgPathSegment(ref);
  const qs = org ? `?org=${encodeURIComponent(org)}` : "";
  const m = await httpJson(`${REGISTRY}/api/v1/packages/${seg}/manifest${qs}`);
  let versions = [];
  try {
    const v = await httpJson(`${REGISTRY}/api/v1/packages/${seg}/versions${qs}`);
    versions = v.versions || [];
  } catch {}
  let distTags = {};
  try {
    const t = await httpJson(`${REGISTRY}/api/v1/packages/${seg}/dist-tags${qs}`);
    distTags = t.dist_tags || {};
  } catch {}

  process.stdout.write(`${bold(m.slug)}@${m.version}  (${m._type || m.type || "?"})\n`);
  if (m.description) process.stdout.write(`${m.description}\n`);
  if (m.deprecated) process.stdout.write(`${yel("DEPRECATED:")} ${m.deprecated}\n`);

  // Author-side hints (visibility, scope, engines). These ride the manifest
  // for free; surface them so consumers know whether the package they're
  // about to install is private, dev-only, or requires a newer CLI.
  const hints = [];
  if (m.visibility && m.visibility !== "public") hints.push(`visibility=${yel(m.visibility)}`);
  if (m.scope && m.scope !== "either") hints.push(`scope=${m.scope}`);
  if (m.engines && m.engines.adompkg) hints.push(`requires adompkg ${m.engines.adompkg}`);
  if (m.needs_sudo) hints.push(yel("needs sudo"));
  if (hints.length > 0) process.stdout.write(hints.join("  ·  ") + "\n");

  if (m.repository && m.repository.url) {
    const t = m.repository.type || "git";
    process.stdout.write(`Repository: ${m.repository.url} (${t})\n`);
  }
  if (m.homepage) process.stdout.write(`Homepage:   ${m.homepage}\n`);

  const renderDepBlock = (title, deps) => {
    const entries = Object.entries(deps || {});
    if (entries.length === 0) return;
    process.stdout.write(`\n${title}:\n`);
    for (const [s, sp] of entries) process.stdout.write(`  ${s}: ${sp}\n`);
  };
  // Always show runtime; sections without entries don't print, so a clean
  // package looks tight.
  const rt = m.dependencies || {};
  process.stdout.write("\nDependencies:\n");
  if (Object.keys(rt).length === 0) process.stdout.write("  (none)\n");
  else for (const [s, sp] of Object.entries(rt)) process.stdout.write(`  ${s}: ${sp}\n`);
  renderDepBlock("Peer dependencies", m.peerDependencies);
  renderDepBlock("Optional dependencies", m.optionalDependencies);
  renderDepBlock("Dev dependencies (install with --dev)", m.devDependencies);

  // Lifecycle hooks the package declares — non-trivial install behavior
  // the consumer should know about up front.
  const lifecycle = [];
  if (m.scripts && m.scripts.prepublish) lifecycle.push(["prepublish", m.scripts.prepublish]);
  if (m.scripts && m.scripts.postinstall) lifecycle.push(["postinstall", m.scripts.postinstall]);
  if (lifecycle.length > 0) {
    process.stdout.write("\nLifecycle hooks:\n");
    for (const [k, v] of lifecycle) process.stdout.write(`  ${k}: ${v}\n`);
  }

  if (Object.keys(distTags).length) {
    process.stdout.write("\nDist-tags:\n");
    for (const [t, v] of Object.entries(distTags)) process.stdout.write(`  ${t}: ${v}\n`);
  }
  if (m.integrity) process.stdout.write(`\nIntegrity: ${m.integrity}\n`);
  if (versions.length > 0) {
    process.stdout.write("\nVersions:\n");
    for (const v of versions.slice(0, 10)) {
      const dep = v.deprecated ? yel(" DEPRECATED") : "";
      process.stdout.write(`  ${v.version}  ${v.published_at || ""}${dep}\n`);
    }
    if (versions.length > 10) process.stdout.write(`  ... and ${versions.length - 10} more\n`);
  }
}

// ------------------------------------------------------------
// Bootstrap
// ------------------------------------------------------------

// `adompkg bootstrap [<slug>]` is now a thin alias for `adompkg install`
// with the slug defaulting to adom-core. It existed historically as its
// own verb but the behavior was always "install this meta package" —
// there's no reason to fork the semantics. Kept for back-compat.
async function cmdBootstrap(args = []) {
  const slug = args[0] || "adom-core";
  process.stdout.write(`(adompkg bootstrap → adompkg install ${slug})\n`);
  await cmdInstall([slug]);
}

// ------------------------------------------------------------
// dist-tag, deprecate, audit, ci
// ------------------------------------------------------------

async function cmdDistTag(args) {
  if (args.length === 0) die("usage: adompkg dist-tag <add|rm|ls> ...");
  const sub = args[0];
  const rest = args.slice(1);

  if (sub === "ls" || sub === "list") {
    if (rest.length === 0) die("usage: adompkg dist-tag ls <owner>/<slug>");
    const { value: orgArg, rest: r2 } = pickFlag(rest, "--org");
    const seg = pkgPathSegment(r2[0]);
    const qs = (orgArg || DEFAULT_ORG) ? `?org=${encodeURIComponent(orgArg || DEFAULT_ORG)}` : "";
    const data = await httpJson(`${REGISTRY}/api/v1/packages/${seg}/dist-tags${qs}`);
    const tags = data.dist_tags || {};
    if (Object.keys(tags).length === 0) { process.stdout.write("(no tags)\n"); return; }
    for (const [t, v] of Object.entries(tags)) process.stdout.write(`${t}: ${v}\n`);
    return;
  }

  if (sub === "add" || sub === "set") {
    // adompkg dist-tag add <owner>/<slug>@version tag [--org name]
    const { value: orgArg, rest: r2 } = pickFlag(rest, "--org");
    if (r2.length < 2) die("usage: adompkg dist-tag add <owner>/<slug>@<version> <tag>");
    // edge case 19: require an explicit @version so we don't silently send
    // "latest" as a version and get a confusing 404.
    if (!r2[0].includes("@")) {
      die(`dist-tag add requires a version: '<owner>/<slug>@<version>' (got '${r2[0]}')`);
    }
    const sv = parseSlugSpec(r2[0]);
    if (!sv.spec || sv.spec === "latest") {
      die(`dist-tag add requires a concrete version after '@' (got '${r2[0]}')`);
    }
    const tag = r2[1];
    const seg = pkgPathSegment(sv.ref);
    const qs = (orgArg || DEFAULT_ORG) ? `?org=${encodeURIComponent(orgArg || DEFAULT_ORG)}` : "";
    const res = await fetch(`${REGISTRY}/api/v1/packages/${seg}/dist-tags/${encodeURIComponent(tag)}${qs}`, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ version: sv.spec }),
    });
    const text = await res.text();
    if (!res.ok) {
      // edge case 19: surface a clean "version does not exist" if the server said 404.
      if (res.status === 404) {
        die(`version ${sv.spec} does not exist for ${sv.ref}`);
      }
      die(`HTTP ${res.status}: ${text}`);
    }
    process.stdout.write(`Tagged ${sv.ref}@${sv.spec} as ${tag}\n`);
    return;
  }

  if (sub === "rm" || sub === "remove" || sub === "del") {
    const { value: orgArg, rest: r2 } = pickFlag(rest, "--org");
    if (r2.length < 2) die("usage: adompkg dist-tag rm <owner>/<slug> <tag>");
    const ref = r2[0];
    const seg = pkgPathSegment(ref);
    const tag = r2[1];
    const qs = (orgArg || DEFAULT_ORG) ? `?org=${encodeURIComponent(orgArg || DEFAULT_ORG)}` : "";
    const res = await fetch(`${REGISTRY}/api/v1/packages/${seg}/dist-tags/${encodeURIComponent(tag)}${qs}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    const text = await res.text();
    if (!res.ok) die(`HTTP ${res.status}: ${text}`);
    process.stdout.write(`Removed tag ${tag} from ${ref}\n`);
    return;
  }

  die(`unknown dist-tag subcommand: ${sub}`);
}

async function cmdDeprecate(args) {
  // adompkg deprecate <owner>/<slug>@<version> "message"   (empty msg = undeprecate)
  const { value: orgArg, rest } = pickFlag(args, "--org");
  if (rest.length < 1) die('usage: adompkg deprecate <owner>/<slug>@<version> "message"');
  const sv = parseSlugSpec(rest[0]);
  const seg = pkgPathSegment(sv.ref);
  const message = rest.slice(1).join(" ") || "";
  const qs = (orgArg || DEFAULT_ORG) ? `?org=${encodeURIComponent(orgArg || DEFAULT_ORG)}` : "";
  const res = await fetch(`${REGISTRY}/api/v1/packages/${seg}/${encodeURIComponent(sv.spec)}/deprecate${qs}`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ message }),
  });
  const text = await res.text();
  if (!res.ok) die(`HTTP ${res.status}: ${text}`);
  if (message) process.stdout.write(`Deprecated ${sv.ref}@${sv.spec}: ${message}\n`);
  else process.stdout.write(`Undeprecated ${sv.ref}@${sv.spec}\n`);
}

async function cmdPlatform(args) {
  // adompkg platform <owner>/<slug>@<version> <platform> [--from <p>]
  // Retroactively re-tag a published release's platform (owner/admin). Renames
  // the tarball + updates the row; bytes/hash/signature are unchanged.
  const { value: orgArg, rest: r1 } = pickFlag(args, "--org");
  const { value: fromArg, rest } = pickFlag(r1, "--from");
  if (rest.length < 2) {
    die("usage: adompkg platform <owner>/<slug>@<version> <platform> [--from <p>]\n  platform: windows | macos | linux | any  (--from defaults to 'any')");
  }
  const sv = parseSlugSpec(rest[0]);
  const platform = rest[1];
  const seg = pkgPathSegment(sv.ref);
  const qs = (orgArg || DEFAULT_ORG) ? `?org=${encodeURIComponent(orgArg || DEFAULT_ORG)}` : "";
  const res = await fetch(`${REGISTRY}/api/v1/packages/${seg}/${encodeURIComponent(sv.spec)}/platform${qs}`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ platform, from: fromArg || "any" }),
  });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = {}; }
  if (!res.ok) die(parsed.hint ? `${parsed.error || `HTTP ${res.status}`}\n  hint: ${parsed.hint}` : `HTTP ${res.status}: ${text}`);
  process.stdout.write(`Re-tagged ${sv.ref}@${sv.spec}: ${parsed.from} -> ${parsed.platform}\n`);
  if (parsed.hint) process.stdout.write(`  hint: ${parsed.hint}\n`);
}

// Upload downloadable release-asset binaries via multipart (shared by `publish`
// bundling and `release upload`). Returns the server's asset rows.
async function uploadReleaseAssets(seg, version, paths, { cwd = ".", platform = null, qs = "" } = {}) {
  const form = new FormData();
  if (platform) form.append("platform", platform);
  let count = 0;
  for (const rel of paths) {
    const abs = path.isAbsolute(rel) ? rel : path.join(cwd, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) { process.stderr.write(`  skip (not a file): ${rel}\n`); continue; }
    form.append("files", new Blob([fs.readFileSync(abs)]), path.basename(abs));
    count++;
  }
  if (!count) return [];
  const res = await fetch(`${REGISTRY}/api/v1/packages/${seg}/${encodeURIComponent(version)}/assets${qs}`, {
    method: "POST", body: form, headers: authHeaders(),
  });
  const text = await res.text();
  if (!res.ok) {
    let p; try { p = JSON.parse(text); } catch { p = {}; }
    throw new Error(p.hint ? `${p.error || `HTTP ${res.status}`}\n  hint: ${p.hint}` : (p.error || `HTTP ${res.status}: ${text}`));
  }
  return (JSON.parse(text).assets) || [];
}

// adompkg release <upload|list> — manage downloadable release-asset binaries
// (the GitHub-"Releases" store: raw downloads, no untar, kept out of git).
async function cmdRelease(args) {
  const sub = args[0];
  const rest = args.slice(1);
  if (sub === "upload") {
    const { value: orgArg, rest: r1 } = pickFlag(rest, "--org");
    const { value: platformArg, rest: r2 } = pickFlag(r1, "--platform");
    if (r2.length < 2) usage('usage: adompkg release upload <owner>/<slug>@<version> <file...> [--platform windows|macos|linux]');
    const sv = parseSlugSpec(r2[0]);
    const seg = pkgPathSegment(sv.ref);
    const qs = (orgArg || DEFAULT_ORG) ? `?org=${encodeURIComponent(orgArg || DEFAULT_ORG)}` : "";
    const uploaded = await uploadReleaseAssets(seg, sv.spec, r2.slice(1), { cwd: process.cwd(), platform: platformArg, qs });
    if (!uploaded.length) die("no files uploaded (none of the given paths were files)");
    process.stdout.write(`Uploaded ${uploaded.length} asset(s) to ${sv.ref}@${sv.spec}:\n`);
    for (const a of uploaded) process.stdout.write(`  ${a.filename} (${a.platform}, ${(a.size / 1048576).toFixed(1)} MB)  ${REGISTRY}${a.download_url}\n`);
    return;
  }
  if (sub === "list") {
    const { value: orgArg, rest: r1 } = pickFlag(rest, "--org");
    if (!r1[0]) usage('usage: adompkg release list <owner>/<slug>@<version>');
    const sv = parseSlugSpec(r1[0]);
    const seg = pkgPathSegment(sv.ref);
    const qs = (orgArg || DEFAULT_ORG) ? `?org=${encodeURIComponent(orgArg || DEFAULT_ORG)}` : "";
    const data = await httpJson(`${REGISTRY}/api/v1/packages/${seg}/${encodeURIComponent(sv.spec)}/assets${qs}`);
    if (!data.assets || !data.assets.length) { process.stdout.write(`No release assets for ${sv.ref}@${sv.spec}\n`); return; }
    for (const a of data.assets) process.stdout.write(`  ${a.filename}  ${a.platform}  ${(a.size / 1048576).toFixed(1)} MB  ${a.download_count} downloads  ${REGISTRY}${a.download_url}\n`);
    return;
  }
  usage("usage: adompkg release <upload|list> <owner>/<slug>@<version> [...]");
}

// Vouch that you trust a package (a community-trust signal). Mirrors
// POST|DELETE /api/v1/packages/<owner>/<slug>/vouch.
async function cmdVouch(args) {
  const rm = pickBoolFlag(args, "--remove");
  const ref = rm.rest[0];
  if (!ref) usage("usage: adompkg vouch <owner>/<slug>   (remove: adompkg vouch --remove <owner>/<slug>)");
  const { owner, slug } = splitRef(ref);
  if (!owner) die("vouch requires an owner-qualified ref: <owner>/<slug>", EXIT_USAGE);
  const url = `${REGISTRY}/api/v1/packages/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}/vouch`;
  const res = await fetch(url, { method: rm.value ? "DELETE" : "POST", headers: authHeaders() });
  const text = await res.text();
  if (!res.ok) die(`HTTP ${res.status}: ${text}`);
  let data = {}; try { data = JSON.parse(text); } catch {}
  process.stdout.write(`${rm.value ? "Removed vouch for" : "Vouched for"} ${owner}/${slug} (${data.count || 0} total)\n`);
}

async function cmdAudit(args = []) {
  const layoutRes = pickBoolFlag(args, "--layout");
  if (layoutRes.value) return cmdAuditLayout();

  const installed = loadInstalled();
  const names = Object.keys(installed);
  if (names.length === 0) { process.stdout.write("No packages installed.\n"); return; }

  const rows = [];
  for (const name of names) {
    const info = installed[name];
    const seg = info.slug
      ? pkgPathSegment(info.owner ? `${info.owner}/${info.slug}` : info.slug)
      : pkgPathSegment(name);
    try {
      const m = await httpJson(`${REGISTRY}/api/v1/packages/${seg}/${info.version}/manifest`);
      rows.push({ slug: name, version: info.version, deprecated: m.deprecated || null });
    } catch (err) {
      rows.push({ slug: name, version: info.version, error: err.message });
    }
  }
  process.stdout.write(`${bold(pad("PACKAGE", 28))} ${bold(pad("VERSION", 10))} ${bold(pad("STATUS", 12))} ${bold("MESSAGE")}\n`);
  let nDep = 0, nOk = 0;
  for (const r of rows) {
    const status = r.error ? "ERROR" : (r.deprecated ? "DEPRECATED" : "OK");
    const msg = r.error || r.deprecated || "";
    process.stdout.write(`${pad(r.slug, 28)} ${pad(r.version, 10)} ${pad(status, 12)} ${msg}\n`);
    if (status === "DEPRECATED") nDep++;
    else if (status === "OK") nOk++;
  }
  process.stdout.write(`\n${nDep} deprecated, ${nOk} ok\n`);
  process.exit(nDep > 0 ? 1 : 0);
}

// `adompkg audit --layout` — scans the install targets (bin dirs + skills
// dir) and reports which entries are symlinks back into ~/project/adom_modules/
// (correct, per Adom convention) vs real files (drift — the package's
// install.sh used cp/install and the AI/user can't edit the modules-dir
// source to affect what's installed). Diagnostic only; no auto-fix.
async function cmdAuditLayout() {
  const installed = loadInstalled();
  const slugs = Object.keys(installed);
  if (slugs.length === 0) { process.stdout.write("No packages installed.\n"); return; }

  const targets = [
    { dir: path.join(HOME, ".local", "bin"), kind: "bin" },
    { dir: "/usr/local/bin", kind: "bin" },
    { dir: path.join(HOME, ".claude", "skills"), kind: "skill" },
  ];

  const rows = [];
  for (const key of slugs) {
    const info = installed[key] || {};
    // Install targets (bin name / skill dir) are named by the bare slug, since
    // that's what install.sh links. The modules-dir prefix is owner-scoped.
    const slug = info.slug || splitRef(key).slug;
    const modPrefix = info.slug
      ? moduleDirFor(info.owner || null, info.slug)
      : moduleDirFor(key);
    const matches = [];
    for (const { dir, kind } of targets) {
      if (!fs.existsSync(dir)) continue;
      let entries;
      try { entries = fs.readdirSync(dir); } catch { continue; }
      for (const name of entries) {
        // For bin dirs, match by basename == slug or starts-with slug. For
        // skills, the entry IS the slug (it's a slug-named dir).
        if (kind === "skill" && name !== slug) continue;
        if (kind === "bin" && name !== slug) continue;
        const full = path.join(dir, name);
        let stat;
        try { stat = fs.lstatSync(full); } catch { continue; }
        let resolvedInto = null;
        let isSymlink = stat.isSymbolicLink();
        if (isSymlink) {
          try {
            const real = fs.realpathSync(full);
            resolvedInto = real.startsWith(modPrefix) ? "modules" : real;
          } catch {
            resolvedInto = "(broken)";
          }
        }
        matches.push({ kind, dir, name, isSymlink, resolvedInto });
      }
    }
    rows.push({ slug: key, matches });
  }

  let ok = 0, drift = 0, broken = 0;
  for (const r of rows) {
    if (r.matches.length === 0) {
      process.stdout.write(`${pad(r.slug, 28)}  ${dim("(no install targets found)")}\n`);
      continue;
    }
    for (const m of r.matches) {
      let status, detail;
      if (!m.isSymlink) {
        status = red("DRIFT");
        detail = "real file (should be symlink into adom_modules/)";
        drift++;
      } else if (m.resolvedInto === "modules") {
        status = grn("OK");
        detail = `symlink -> adom_modules/${r.slug}/...`;
        ok++;
      } else if (m.resolvedInto === "(broken)") {
        status = red("BROKEN");
        detail = "symlink target missing";
        broken++;
      } else {
        status = yel("FOREIGN");
        detail = `symlink -> ${m.resolvedInto}`;
        drift++;
      }
      process.stdout.write(`${pad(r.slug, 28)}  ${pad(m.kind, 6)}  ${pad(m.name, 28)}  ${status}  ${detail}\n`);
    }
  }
  process.stdout.write(`\n${ok} ok, ${drift} drift, ${broken} broken\n`);
  if (drift > 0) {
    process.stdout.write(
      `\nDrift means the install target is a real copy, not a symlink into ${PREFIX}/<slug>/.\n` +
      `Editing the modules-dir source won't affect what's installed; reinstalls will clobber any edits.\n` +
      `Fix: re-publish the package with an install.sh that uses 'source "$(adompkg sh-helpers)"' + adompkg-link-bin/skill.\n`,
    );
  }
}

async function cmdCi(args) {
  const { value: frozen } = pickBoolFlag(args, "--frozen");
  const lock = loadLock();
  if (!lock) {
    if (frozen) die("--frozen specified but .lock.json does not exist");
    die(".lock.json does not exist (run install first, or omit --frozen to regenerate)");
  }
  const installed = loadInstalled();

  // Verify the lock matches the installed manifest exactly (same packages + versions).
  const lockPkgs = lock.packages || {};
  const lockSlugs = new Set(Object.keys(lockPkgs));
  const instSlugs = new Set(Object.keys(installed));

  const onlyInLock = [...lockSlugs].filter(s => !instSlugs.has(s));
  const onlyInInst = [...instSlugs].filter(s => !lockSlugs.has(s));
  const versionMismatches = [];
  for (const slug of lockSlugs) {
    if (!installed[slug]) continue;
    if (installed[slug].version !== lockPkgs[slug].version) {
      versionMismatches.push(`${slug}: installed=${installed[slug].version} lock=${lockPkgs[slug].version}`);
    }
  }
  if (onlyInLock.length > 0 || onlyInInst.length > 0 || versionMismatches.length > 0) {
    process.stderr.write("ci: lock.json out of sync with installed.json:\n");
    if (onlyInLock.length > 0) process.stderr.write(`  in lock but not installed: ${onlyInLock.join(", ")}\n`);
    if (onlyInInst.length > 0) process.stderr.write(`  installed but not in lock: ${onlyInInst.join(", ")}\n`);
    if (versionMismatches.length > 0) for (const m of versionMismatches) process.stderr.write(`  ${m}\n`);
    process.exit(1);
  }

  // Replay install for each lock entry in the topological order.
  const order = lock.order || Object.keys(lockPkgs);
  process.stdout.write(`ci: reinstalling ${order.length} package(s) from lock...\n`);

  const fresh = {};
  for (const name of order) {
    const entry = lockPkgs[name];
    if (!entry) continue;

    // Recover owner/slug from the lock entry; fall back to parsing the key.
    const owner = entry.owner !== undefined ? entry.owner : splitRef(name).owner;
    const slug = entry.slug || splitRef(name).slug;
    const moduleDir = moduleDirFor(owner, slug);
    if (fs.existsSync(moduleDir)) fs.rmSync(moduleDir, { recursive: true, force: true });

    const cacheTar = cachedTarballPath(owner, slug, entry.version);
    // Use cached if present, else download.
    if (!fs.existsSync(cacheTar)) {
      process.stdout.write(`  downloading ${name}@${entry.version}...\n`);
      await httpDownload(`${REGISTRY}${entry.tarball}`, cacheTar);
    } else {
      process.stdout.write(`  using cached ${name}@${entry.version}\n`);
    }

    // SECURITY (#2): the lockfile/ci path must enforce the SAME integrity AND
    // signature verification as installOne before extracting or running any
    // install script. The old ci path only compared integrity when present
    // (skippable by a missing/empty hash) and never checked the signature at
    // all — so a tampered .lock.json (e.g. a malicious PR) gave unattended code
    // execution in CI. The signature/signing-key live on the resolved entry.
    const resolvedEntry = (lock.resolved || []).find(r => (r.name || r.slug) === name) || {};
    const actual = await verifyTarball({
      name, owner, slug, version: entry.version, cacheTar,
      respHeaders: null, // ci replays from the lock, not a live response
      integrity: entry.integrity,
      signature: resolvedEntry.signature,
      signing_key_id: resolvedEntry.signing_key_id,
    });

    // SECURITY (#23): the lockfile/ci path must run the same zip-slip check as
    // installOne before extracting — a malicious/mirrored tarball can contain
    // ../ or escaping-symlink members that write outside moduleDir.
    assertSafeArchive(cacheTar);
    fs.mkdirSync(moduleDir, { recursive: true });
    execFileSync("tar", ["xzf", cacheTar, "-C", moduleDir], { stdio: "inherit" });

    const scriptName = resolvedEntry.scripts?.install || "./install.sh";
    if (entry.type !== "bootstrap" && ignoreScripts()) {
      process.stdout.write(`  ${yel("skipping")} install script (${scriptName}) — --ignore-scripts\n`);
    } else if (entry.type !== "bootstrap") {
      // SECURITY (#23): keep the install script path inside the module dir.
      const scriptPath = path.resolve(moduleDir, scriptName.replace(/^\.\//, ""));
      if (!scriptPath.startsWith(path.resolve(moduleDir) + path.sep)) {
        die(`install script path '${scriptName}' escapes the module directory`);
      }
      if (fs.existsSync(scriptPath)) {
        process.stdout.write(`  running install script (${scriptName})...\n`);
        runScript(scriptPath, moduleDir, !!resolvedEntry.needs_sudo);
      }
    }

    // Run the postinstall hook too, mirroring installOne — a package that
    // relies on postinstall would otherwise be left half-configured after a
    // `ci` reinstall, defeating ci's reproducible-environment guarantee.
    const postinstallScript = resolvedEntry.scripts?.postinstall;
    if (postinstallScript && entry.type !== "bootstrap" && ignoreScripts()) {
      process.stdout.write(`  ${yel("skipping")} postinstall (${postinstallScript}) — --ignore-scripts\n`);
    } else if (postinstallScript && entry.type !== "bootstrap") {
      const hookPath = path.resolve(moduleDir, postinstallScript.replace(/^\.\//, ""));
      if (!hookPath.startsWith(path.resolve(moduleDir) + path.sep)) {
        die(`postinstall path '${postinstallScript}' escapes the module directory`);
      }
      if (fs.existsSync(hookPath)) {
        process.stdout.write(`  running postinstall (${postinstallScript})...\n`);
        runScript(hookPath, moduleDir, !!resolvedEntry.needs_sudo);
      }
    }

    fresh[name] = {
      version: entry.version,
      type: entry.type,
      owner,
      slug,
      dependencies: entry.dependencies || {},
      needs_sudo: !!resolvedEntry.needs_sudo,
      installedAt: new Date().toISOString(),
      integrity: actual,
      org_id: entry.org_id || null,
      org_name: resolvedEntry.org_name || null,
      // Preserve scope so `list`/`why`/`uninstall --dev` keep working after ci.
      dev: !!entry.dev,
      optional: !!entry.optional,
    };
  }

  saveInstalled(fresh);
  process.stdout.write("ci: complete.\n");
}

// ------------------------------------------------------------
// Auth commands: login, logout, whoami
// ------------------------------------------------------------

function promptLine(question, { hidden = false } = {}) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    if (hidden) {
      // Manual masking: turn off echo by overriding the output stream's write.
      const origWrite = rl._writeToOutput;
      rl._writeToOutput = function(stringToWrite) {
        if (stringToWrite && stringToWrite.includes(question)) {
          origWrite.call(rl, stringToWrite);
        } else {
          origWrite.call(rl, "");
        }
      };
    }
    rl.question(question, answer => {
      if (hidden) process.stdout.write("\n");
      rl.close();
      resolve(answer);
    });
    rl.on("error", reject);
  });
}


async function cmdWhoami() {
  const token = getToken();
  if (!token) {
    process.stderr.write("Not logged in. Set ADOMPKG_TOKEN, or run inside an Adom container where /var/run/adom/api-key is auto-mounted.\n");
    process.exit(EXIT_ERR);
  }
  let userRes;
  try {
    userRes = await fetch(`${CARBON_URL}/user`, { headers: { Authorization: `Bearer ${token}` } });
  } catch (err) {
    die(`could not reach Carbon at ${CARBON_URL}: ${describeFetchError(err, CARBON_URL)}`);
  }
  if (!userRes.ok) {
    if (userRes.status === 401) {
      die("token rejected by Carbon (HTTP 401). Set a fresh ADOMPKG_TOKEN (or refresh the container API key).");
    }
    die(`Carbon returned HTTP ${userRes.status} for /user`);
  }
  const u = await userRes.json();
  // Try to fetch orgs too — non-fatal if it fails.
  let orgs = [];
  try {
    const r = await fetch(`${CARBON_URL}/user/orgs`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) {
      const data = await r.json();
      if (Array.isArray(data)) orgs = data;
    }
  } catch {}
  const name = u.display_name || u.name || u.id;
  const email = u.email || "(no email)";
  process.stdout.write(`Logged in as: ${name} <${email}>\n`);
  process.stdout.write(`User ID: ${u.id}\n`);
  if (orgs.length > 0) {
    process.stdout.write(`Orgs: ${orgs.map(o => o.display_name || o.name || o.id).join(", ")}\n`);
  } else {
    process.stdout.write(`Orgs: (none)\n`);
  }
  if (process.env.ADOMPKG_TOKEN) {
    process.stdout.write(`Source: ADOMPKG_TOKEN environment variable\n`);
  } else {
    process.stdout.write(`Source: /var/run/adom/api-key (container Carbon token)\n`);
  }
}

// ------------------------------------------------------------
// init: scaffold a new package source directory
// ------------------------------------------------------------

// ------------------------------------------------------------
// `adompkg sh-helpers` — print the absolute path to a bash helper script
// that defines `adompkg-link-bin` and `adompkg-link-skill`. Authors source
// it from their install.sh so they don't have to remember the `ln -sfn`
// boilerplate.
//
// Usage in an install.sh:
//   source "$(adompkg sh-helpers)"
//   adompkg-link-bin adom-mouser           # -> ~/.local/bin/adom-mouser
//   adompkg-link-skill adom-mouser         # -> ~/.claude/skills/adom-mouser/
//
// Both helpers point the install target at the package's modules-dir
// source (the current working dir of the install.sh, which is the
// extracted module dir).
// ------------------------------------------------------------

const SH_HELPERS_CONTENT = `# adompkg shell helpers (sourced from install.sh).
# Convention: every install target is a symlink back into ~/project/adom_modules/<slug>/.
# Edits in the modules dir propagate; reinstalls don't clobber.
#
# These helpers assume install.sh runs with cwd = the extracted module dir,
# which is what 'adompkg install' guarantees. The source dir is just \$PWD.

# Symlink a binary onto PATH. Default target: ~/.local/bin/<name>.
#   adompkg-link-bin <name>                   # source: ./bin/<name>
#   adompkg-link-bin <name> <relative-path>   # source: ./<relative-path>
#   ADOMPKG_BIN_DIR=/usr/local/bin adompkg-link-bin ...   # system-wide
adompkg-link-bin() {
  local name="\$1"
  local rel="\${2:-bin/\$name}"
  local src_dir="\$PWD"
  local target="\${ADOMPKG_BIN_DIR:-\$HOME/.local/bin}"
  mkdir -p "\$target"
  # Collision guard: ~/.local/bin and /usr/local/bin are flat namespaces, so a
  # same-named binary from a DIFFERENT package would silently clobber. Warn.
  if [ -e "\$target/\$name" ] || [ -L "\$target/\$name" ]; then
    local existing; existing="\$(readlink "\$target/\$name" 2>/dev/null || true)"
    if [ -n "\$existing" ] && [ "\$existing" != "\$src_dir/\$rel" ]; then
      echo "WARNING: \$target/\$name already points to \$existing — overwriting with \$src_dir/\$rel (two packages claim the binary name '\$name')." >&2
    fi
  fi
  ln -sfn "\$src_dir/\$rel" "\$target/\$name"
  chmod +x "\$src_dir/\$rel" 2>/dev/null || true
  echo "Linked \$target/\$name -> \$src_dir/\$rel"
}

# Symlink a skill into ~/.claude/skills/<slug>/.
#   adompkg-link-skill <slug>                 # source: ./skills/<slug>
#   adompkg-link-skill <slug> <relative-path> # source: ./<relative-path>
adompkg-link-skill() {
  local slug="\$1"
  # Guard an empty slug BEFORE deriving any path from it: dest would become
  # "\$target/" and the real-dir replace step (rm -rf "\$dest") would wipe the
  # entire ~/.claude/skills directory.
  if [ -z "\$slug" ]; then
    echo "ERROR: adompkg-link-skill: empty slug — refusing (would target the whole skills dir)." >&2
    return 1
  fi
  local rel="\${2:-skills/\$slug}"
  local src_dir="\$PWD"
  local target="\$HOME/.claude/skills"
  mkdir -p "\$target"
  local dest="\$target/\$slug"
  # Never create a dangling link, and never destroy an existing skill for a
  # source that isn't there (e.g. flat package layout while rel defaulted to
  # skills/<slug>).
  if [ ! -e "\$src_dir/\$rel" ]; then
    echo "ERROR: adompkg-link-skill: source '\$src_dir/\$rel' does not exist — refusing to link (dest untouched)." >&2
    return 1
  fi
  # Collision guard: ~/.claude/skills/<slug> is a flat namespace (Claude
  # discovers skills by bare name), so two owners' same-named skill collide.
  if [ -e "\$dest" ] || [ -L "\$dest" ]; then
    local existing; existing="\$(readlink "\$dest" 2>/dev/null || true)"
    if [ -n "\$existing" ] && [ "\$existing" != "\$src_dir/\$rel" ]; then
      echo "WARNING: skill '\$slug' already installed from \$existing — overwriting with \$src_dir/\$rel (two packages claim the skill name '\$slug')." >&2
    fi
    # A NON-symlink (real dir from another installer, e.g. gallia install.mjs)
    # squatting the slug would make ln -sfn nest the link INSIDE it as
    # <slug>/<slug>, corrupting the skill. Replace it instead.
    if [ -e "\$dest" ] && [ ! -L "\$dest" ]; then
      echo "WARNING: skill '\$slug' was a real directory (likely from another installer) — replacing with adompkg symlink." >&2
      rm -rf "\$dest"
    fi
  fi
  # -T: treat dest as the link name itself — never create inside a directory.
  ln -sfnT "\$src_dir/\$rel" "\$dest"
  echo "Linked \$dest -> \$src_dir/\$rel"
}
`;

function ensureShHelpers() {
  const dir = path.join(HOME, ".adompkg");
  const file = path.join(dir, "sh-helpers.sh");
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    if (current !== SH_HELPERS_CONTENT) {
      fs.writeFileSync(file, SH_HELPERS_CONTENT);
    }
  } catch (err) {
    die(`failed to write ${file}: ${err.message}`);
  }
  return file;
}

function cmdShHelpers() {
  const file = ensureShHelpers();
  process.stdout.write(file + "\n");
}

// ------------------------------------------------------------
// `adompkg doctor` — install diagnostic.
//
// Each check returns { name, status: 'ok'|'warn'|'fail', detail, hint? }.
// Failures get a non-zero exit; warnings don't. Use as the first thing a
// new user runs when something feels off — answers "did my install work?".
// ------------------------------------------------------------

async function cmdDoctor() {
  const checks = [];

  // 1. ~/.local/bin on PATH.
  const localBin = path.join(HOME, ".local", "bin");
  const pathSegs = (process.env.PATH || "").split(":");
  checks.push(pathSegs.includes(localBin)
    ? { name: "PATH includes ~/.local/bin", status: "ok" }
    : { name: "PATH includes ~/.local/bin", status: "warn",
        detail: `${localBin} is not in $PATH`,
        hint: "Add it to ~/.bashrc / ~/.zshrc: export PATH=\"$HOME/.local/bin:$PATH\"" });

  // 2. adompkg binary discoverable.
  const adompkgPath = path.join(localBin, "adompkg");
  checks.push(fs.existsSync(adompkgPath)
    ? { name: "adompkg installed at ~/.local/bin/adompkg", status: "ok" }
    : { name: "adompkg installed at ~/.local/bin/adompkg", status: "warn",
        detail: "no binary at that path",
        hint: "Re-run the bootstrap one-liner from the wiki." });

  // 3. Token available.
  let tokenSource = null;
  if (process.env.ADOMPKG_TOKEN) tokenSource = "ADOMPKG_TOKEN env";
  else {
    try {
      const v = fs.readFileSync("/var/run/adom/api-key", "utf8").trim();
      if (v) tokenSource = "/var/run/adom/api-key";
    } catch {}
  }
  checks.push(tokenSource
    ? { name: "auth token available", status: "ok", detail: `source: ${tokenSource}` }
    : { name: "auth token available", status: "fail",
        detail: "no token from /var/run/adom/api-key, no ADOMPKG_TOKEN env",
        hint: "Inside Adom containers the container API key is auto-mounted; check that /var/run/adom/api-key exists. Outside, export ADOMPKG_TOKEN." });

  // 4. modules dir + .installed.json sane.
  if (!fs.existsSync(PREFIX)) {
    checks.push({ name: "modules dir exists", status: "warn",
      detail: `${PREFIX} missing — first install will create it`,
      hint: "Run 'adompkg install <slug>' or 'adompkg bootstrap'." });
  } else {
    checks.push({ name: "modules dir exists", status: "ok", detail: PREFIX });
    if (fs.existsSync(INSTALLED_FILE)) {
      try {
        const inst = JSON.parse(fs.readFileSync(INSTALLED_FILE, "utf8"));
        const count = Object.keys(inst).length;
        checks.push({ name: ".installed.json valid", status: "ok",
          detail: `${count} package${count === 1 ? "" : "s"} installed` });
      } catch (err) {
        checks.push({ name: ".installed.json valid", status: "fail",
          detail: `corrupt JSON: ${err.message}`,
          hint: "Move it aside and rerun 'adompkg install' or 'adompkg ci'." });
      }
    }
  }

  // 5. sh-helpers sourceable.
  try {
    const file = ensureShHelpers();
    const body = fs.readFileSync(file, "utf8");
    if (body.includes("adompkg-link-bin") && body.includes("adompkg-link-skill")) {
      checks.push({ name: "sh-helpers ready", status: "ok", detail: file });
    } else {
      checks.push({ name: "sh-helpers ready", status: "warn",
        detail: "helper file present but missing expected functions",
        hint: "Re-run 'adompkg sh-helpers' to regenerate." });
    }
  } catch (err) {
    checks.push({ name: "sh-helpers ready", status: "warn",
      detail: `failed to materialize: ${err.message}` });
  }

  // 6. UserPromptSubmit hook for update checks (gallia or adom-hook).
  const settingsPath = path.join(HOME, ".claude", "settings.json");
  if (fs.existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      const hooks = (settings.hooks && settings.hooks.UserPromptSubmit) || [];
      const hasUpdateCheck = hooks.some(group =>
        (group.hooks || []).some(h =>
          typeof h.command === "string" && (h.command.includes("check-updates") || h.command.includes("adom-hook"))
        ));
      checks.push(hasUpdateCheck
        ? { name: "update-check hook wired", status: "ok",
            detail: "found check-updates.sh or adom-hook in UserPromptSubmit" }
        : { name: "update-check hook wired", status: "warn",
            detail: "no update-check command in ~/.claude/settings.json UserPromptSubmit",
            hint: "Install adom-hook ('adompkg install adom-hook') or wire gallia's hook manually." });
    } catch (err) {
      checks.push({ name: "update-check hook wired", status: "warn",
        detail: `couldn't parse ${settingsPath}: ${err.message}` });
    }
  } else {
    checks.push({ name: "update-check hook wired", status: "warn",
      detail: "no ~/.claude/settings.json found",
      hint: "Claude Code config missing — install adom-hook to add the update-check, or hand-edit settings.json." });
  }

  // 7. adom-wiki-discover skill (the auto-discovery surface for new wiki content).
  const discoverSkill = path.join(HOME, ".claude", "skills", "adom-wiki-discover");
  checks.push(fs.existsSync(discoverSkill)
    ? { name: "adom-wiki-discover skill installed", status: "ok" }
    : { name: "adom-wiki-discover skill installed", status: "warn",
        detail: `~/.claude/skills/adom-wiki-discover/ missing`,
        hint: "Install via 'adompkg install adom-wiki-discover' to get prompt-time wiki suggestions." });

  // 8. Registry reachable.
  try {
    const res = await fetch(`${REGISTRY}/health`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      checks.push({ name: `registry reachable`, status: "ok", detail: REGISTRY });
    } else {
      checks.push({ name: `registry reachable`, status: "warn",
        detail: `${REGISTRY} -> HTTP ${res.status}` });
    }
  } catch (err) {
    checks.push({ name: `registry reachable`, status: "fail",
      detail: `${REGISTRY} unreachable: ${err.message}`,
      hint: "Check your network. Override the registry with ADOMPKG_REGISTRY." });
  }

  // Render.
  let nFail = 0, nWarn = 0;
  for (const c of checks) {
    const tag = c.status === "ok" ? grn("OK") : c.status === "warn" ? yel("WARN") : red("FAIL");
    process.stdout.write(`  ${pad(tag, 6)} ${c.name}${c.detail ? dim(" — " + c.detail) : ""}\n`);
    if (c.hint && c.status !== "ok") {
      process.stdout.write(`         ${dim("hint: " + c.hint)}\n`);
    }
    if (c.status === "fail") nFail++;
    else if (c.status === "warn") nWarn++;
  }
  process.stdout.write(`\n${checks.length - nFail - nWarn} ok, ${nWarn} warn, ${nFail} fail\n`);
  if (nFail > 0) process.exit(EXIT_ERR);
}

async function cmdInit(args) {
  // adompkg init <slug> [--type app|skill|bootstrap] [--description "..."] [--needs-sudo]
  // Slug is positional; flags can come before or after.
  let { value: typeArg, rest: r1 } = pickFlag(args, "--type");
  let { value: descArg, rest: r2 } = pickFlag(r1, "--description");
  let { value: needsSudoFlag, rest: r3 } = pickBoolFlag(r2, "--needs-sudo");
  let { value: yesFlag, rest: positional } = pickBoolFlag(r3, "--yes");
  if (positional.length === 0) {
    usage("usage: adompkg init <slug> [--type app|skill|bootstrap] [--description \"...\"] [--needs-sudo] [--yes]");
  }
  const slug = positional[0];
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(slug)) {
    usage(`invalid slug '${slug}': must be lowercase letters/digits/hyphens, 2-64 chars, start with a letter.`);
  }

  const targetDir = path.resolve(slug);
  if (fs.existsSync(targetDir)) {
    die(`directory already exists: ${targetDir}. Move or remove it first.`);
  }

  // Interactive prompts (skipped if --yes or non-TTY or all values provided).
  let type = typeArg;
  let description = descArg;
  let needsSudo = needsSudoFlag;
  const canPrompt = !yesFlag && process.stdin.isTTY;
  if (canPrompt && !type) {
    const ans = (await promptLine("Type [app/skill/meta] (app): ")).trim().toLowerCase();
    type = ans || "app";
  }
  if (!type) type = "app";
  if (!["app", "skill", "bootstrap"].includes(type)) {
    usage(`invalid type '${type}': must be one of app, skill, bootstrap.`);
  }
  if (canPrompt && !description) {
    description = (await promptLine("Description: ")).trim();
  }
  if (!description) description = `${slug}: TODO write a one-line description.`;
  if (description.length < 20) {
    description = (description + " — TODO expand this description to at least 20 characters.").slice(0, 200);
  }
  if (canPrompt && !needsSudo && type !== "bootstrap") {
    const ans = (await promptLine("Needs sudo? [y/n] (n): ")).trim().toLowerCase();
    needsSudo = ans === "y" || ans === "yes";
  }

  fs.mkdirSync(targetDir, { recursive: true });
  fs.mkdirSync(path.join(targetDir, "bin"), { recursive: true });

  // package.json
  const pkg = {
    slug,
    version: "0.1.0",
    type,
    description,
    // Tags are required at publish (search/discovery). Seed the type so a fresh
    // scaffold is lint-clean; replace with real, specific tags before publishing.
    tags: [type],
    dependencies: {},
  };
  if (type === "app" || type === "skill") {
    pkg.scripts = { install: "./install.sh", uninstall: "./uninstall.sh" };
    pkg.needs_sudo = !!needsSudo;
  }
  fs.writeFileSync(path.join(targetDir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

  if (type === "app" || type === "skill") {
    // install.sh — uses the symlink helpers so install targets are
    // symlinks back into the modules dir (the Adom convention).
    // Edits in the modules dir propagate, reinstalls don't clobber, and
    // 'adompkg link' can swap the trunk in one step.
    const installSh = `#!/bin/bash
# install.sh for ${slug} (${type}).
# Runs from the extracted module directory (~/project/adom_modules/${slug}/).
set -euo pipefail
source "$(adompkg sh-helpers)"

${type === "app"
  ? `# App install: symlink bin/${slug} onto PATH at ~/.local/bin/${slug}.
# (Pass ADOMPKG_BIN_DIR=/usr/local/bin to install system-wide.)
adompkg-link-bin ${slug}
`
  : `# Skill install: symlink skills/${slug}/ into ~/.claude/skills/${slug}/.
adompkg-link-skill ${slug}
`}
`;
    fs.writeFileSync(path.join(targetDir, "install.sh"), installSh);
    fs.chmodSync(path.join(targetDir, "install.sh"), 0o755);

    const uninstallSh = `#!/bin/bash
# uninstall.sh for ${slug} (${type}).
set -euo pipefail

${type === "app"
  ? `# Remove only the symlink; the canonical files in adom_modules/${slug}/
# are wiped by 'adompkg uninstall' after this script returns.
rm -f "\${HOME}/.local/bin/${slug}"
echo "Uninstalled ${slug}"
`
  : `# Remove only the symlink at ~/.claude/skills/${slug}/.
rm -rf "\${HOME}/.claude/skills/${slug}"
echo "Uninstalled skill ${slug}"
`}
`;
    fs.writeFileSync(path.join(targetDir, "uninstall.sh"), uninstallSh);
    fs.chmodSync(path.join(targetDir, "uninstall.sh"), 0o755);
  }

  if (type === "app") {
    const stub = `#!/bin/bash
echo "${slug} v${pkg.version} — replace this stub with your binary or script."
`;
    fs.writeFileSync(path.join(targetDir, "bin", slug), stub);
    fs.chmodSync(path.join(targetDir, "bin", slug), 0o755);
  }

  // Every app and skill must ship a SKILL.md (it's mandatory at publish), so
  // scaffold one for both. For an app, the skill is how Claude drives the CLI.
  if (type === "skill" || type === "app") {
    const body = type === "app"
      ? `TODO: describe how Claude should drive the ${slug} CLI — the commands, when to use them, and example invocations. This is what Claude reads when the skill triggers.`
      : `TODO: write the skill body. This file is what Claude reads when the skill triggers.`;
    const skillMd = `---
name: ${slug}
description: ${description}
---

# ${slug}

${body}
`;
    fs.writeFileSync(path.join(targetDir, "SKILL.md"), skillMd);
  }

  // README.md — includes a placeholder screenshot reference so the
  // pre-publish lint's "no inline screenshots" warning doesn't fire on
  // the very first publish. Author replaces docs/screenshot.png with a
  // real image before they ship.
  fs.mkdirSync(path.join(targetDir, "docs"), { recursive: true });
  const readme = `# ${slug}

${description}

![Screenshot of ${slug}](docs/screenshot.png)

> Replace \`docs/screenshot.png\` with a real screenshot before publishing.
> The pre-publish lint nags about apps/skills without inline images
> because visual context dramatically improves discoverability.

## Install

\`\`\`
adompkg install ${slug}
\`\`\`

${type === "app" ? `## Usage

\`\`\`
${slug}
\`\`\`
` : ""}
## Develop

\`\`\`
cd ${slug}
adompkg pack             # build a tarball locally to inspect
adompkg publish          # publish to the registry (runs lint first)
\`\`\`

Edit-in-place once published:

\`\`\`
adompkg link ${slug}     # point the installed slug at this checkout
# edit files; changes propagate immediately via the symlink convention
adompkg unlink ${slug}   # restore the published install
\`\`\`

## Optional package.json fields

Add these to \`package.json\` when relevant:

| Field | Purpose |
|---|---|
| \`devDependencies\`    | Tools needed for *editing* this package, not running it (e.g. style guides). Installed only with \`adompkg install --dev\`. |
| \`peerDependencies\`   | Packages this one augments. Auto-installed if missing; shared with the rest of the tree. |
| \`optionalDependencies\` | Nice-to-have integrations; install failures are non-fatal. |
| \`engines.adompkg\`    | Minimum CLI version, e.g. \`">=2.8.0"\`. |
| \`scope\`              | \`"runtime"\` / \`"dev"\` / \`"either"\` — hint to consumers about how this package is meant to be used. |
| \`visibility\`         | \`"public"\` (default) or \`"private"\`. Set on first publish only. |
| \`scripts.prepublish\` | Runs in the project dir before tarball build. Use for code-gen / asset builds. |
| \`scripts.postinstall\`| Runs in the module dir after install.sh succeeds. Use for setup. |
`;
  fs.writeFileSync(path.join(targetDir, "README.md"), readme);

  // release.sh: copy from templates/release.sh if shipped alongside, else inline
  // a minimal version.
  const tplCandidates = [
    path.resolve(__dirnameOrCwd(), "../templates/release.sh"),
    path.resolve(__dirnameOrCwd(), "../../templates/release.sh"),
    "/home/adom/git-wiki/templates/release.sh",
    "/home/adom/project/git-wiki/templates/release.sh",
  ];
  let releaseShContent = null;
  for (const c of tplCandidates) {
    try {
      if (fs.existsSync(c)) { releaseShContent = fs.readFileSync(c, "utf8"); break; }
    } catch {}
  }
  if (!releaseShContent) {
    releaseShContent = `#!/bin/bash
# release.sh: bump + publish ${slug}.
# Usage:  ./release.sh [--bump patch|minor|major]
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
case "\${1:-}" in
  --bump) adompkg version "\${2:-patch}" ;;
  --bump=patch|--bump=minor|--bump=major) adompkg version "\${1#--bump=}" ;;
esac
adompkg publish
`;
  }
  fs.writeFileSync(path.join(targetDir, "release.sh"), releaseShContent);
  fs.chmodSync(path.join(targetDir, "release.sh"), 0o755);

  // .adomignore
  fs.writeFileSync(path.join(targetDir, ".adomignore"),
    ".git\nnode_modules\n*.tgz\n.DS_Store\n");

  process.stdout.write(`\nCreated ${slug}/. Next steps:\n`);
  process.stdout.write(`  cd ${slug}\n`);
  process.stdout.write(`  # edit package.json, install.sh, uninstall.sh\n`);
  process.stdout.write(`  # ${yel("required:")} add docs/hero.png (760px, the tool actually running) — publish is blocked without it\n`);
  process.stdout.write(`  adompkg pack          # build tarball locally to inspect\n`);
  process.stdout.write(`  adompkg publish       # publish to the registry\n`);
}

function __dirnameOrCwd() {
  // Best-effort: when adompkg.mjs is run from ~/.local/bin/adompkg.mjs, its
  // dirname won't contain templates/. The fallbacks above handle that.
  try {
    return path.dirname(new URL(import.meta.url).pathname);
  } catch {
    return process.cwd();
  }
}

// ------------------------------------------------------------
// view: full npm-style info, including reverse-deps
// ------------------------------------------------------------

async function cmdView(args) {
  let { value: orgArg, rest } = pickFlag(args, "--org");
  const org = orgArg || DEFAULT_ORG;
  if (rest.length === 0) usage("usage: adompkg view <owner>/<slug>[@version] [--org <slug>]");
  const { ref, slug, spec } = parseSlugSpec(rest[0]);
  const seg = pkgPathSegment(ref);
  const qs = org ? `?org=${encodeURIComponent(org)}` : "";
  const versionPath = spec && spec !== "latest" ? `/${encodeURIComponent(spec)}` : "";

  let manifest;
  try {
    manifest = await httpJson(`${REGISTRY}/api/v1/packages/${seg}${versionPath}/manifest${qs}`);
  } catch (err) {
    if (err.status === 404) die(`package not found: ${ref}${spec && spec !== "latest" ? `@${spec}` : ""}. Try 'adompkg search ${slug}'.`);
    throw err;
  }

  let versions = [];
  try {
    const v = await httpJson(`${REGISTRY}/api/v1/packages/${seg}/versions${qs}`);
    versions = v.versions || [];
  } catch {}
  let distTags = {};
  try {
    const t = await httpJson(`${REGISTRY}/api/v1/packages/${seg}/dist-tags${qs}`);
    distTags = t.dist_tags || {};
  } catch {}

  // Reverse deps: scan resolve API by querying all packages with this slug
  // in their deps. The registry doesn't expose a direct endpoint, so we
  // approximate by listing publish history of all packages via /api/v1/pages
  // (apps/skills/meta only) and checking their dependencies. A dependency may
  // be declared as a qualified <owner>/<slug> ref or a bare <slug>, so match
  // either.
  let reverseDeps = [];
  try {
    const allManifestsRes = await httpJson(`${REGISTRY}/api/v1/pages?limit=200`);
    const allPages = allManifestsRes.pages || [];
    for (const p of allPages) {
      if (p.slug === slug) continue;
      try {
        const pseg = p.owner ? `${encodeURIComponent(p.owner)}/${encodeURIComponent(p.slug)}` : encodeURIComponent(p.slug);
        const pm = await httpJson(`${REGISTRY}/api/v1/packages/${pseg}/manifest${qs}`);
        const depKeys = pm && pm.dependencies ? Object.keys(pm.dependencies) : [];
        const matchKey = depKeys.find(k => k === ref || k === slug || splitRef(k).slug === slug);
        if (matchKey) {
          reverseDeps.push({ slug: p.owner ? `${p.owner}/${p.slug}` : p.slug, version: pm.version, requires: pm.dependencies[matchKey] });
        }
      } catch {}
    }
  } catch {}

  process.stdout.write(`\n${bold(manifest.slug)}@${manifest.version}  ${dim(`(${manifest._type || manifest.type || "?"})`)}\n`);
  if (manifest.description) process.stdout.write(`${manifest.description}\n`);
  if (manifest.deprecated) process.stdout.write(`${yel("DEPRECATED:")} ${manifest.deprecated}\n`);

  process.stdout.write(`\n${bold("Manifest")}\n`);
  process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");

  if (Object.keys(distTags).length) {
    process.stdout.write(`\n${bold("Dist-tags")}\n`);
    for (const [t, v] of Object.entries(distTags)) process.stdout.write(`  ${t}: ${v}\n`);
  }

  if (manifest.integrity) process.stdout.write(`\n${bold("Integrity")}\n  ${manifest.integrity}\n`);

  // Try to discover tarball size via HEAD.
  try {
    const h = await fetch(`${REGISTRY}/api/v1/packages/${seg}/${manifest.version}/tarball${qs}`, { method: "HEAD" });
    const len = h.headers.get("content-length");
    if (len) {
      process.stdout.write(`\n${bold("Tarball")}\n  ${REGISTRY}/api/v1/packages/${seg}/${manifest.version}/tarball\n  size: ${len} bytes\n`);
    }
  } catch {}

  process.stdout.write(`\n${bold("Dependencies")}\n`);
  const deps = manifest.dependencies || {};
  if (Object.keys(deps).length === 0) process.stdout.write("  (none)\n");
  else for (const [s, sp] of Object.entries(deps)) process.stdout.write(`  ${s}: ${sp}\n`);

  if (versions.length > 0) {
    process.stdout.write(`\n${bold(`Versions (${versions.length})`)}\n`);
    for (const v of versions) {
      const dep = v.deprecated ? yel(" DEPRECATED") : "";
      process.stdout.write(`  ${v.version}  ${v.published_at || ""}${dep}\n`);
    }
  }

  process.stdout.write(`\n${bold("Reverse dependencies")}\n`);
  if (reverseDeps.length === 0) {
    process.stdout.write("  (none — no published package declares this as a dependency)\n");
  } else {
    for (const r of reverseDeps) process.stdout.write(`  ${r.slug}@${r.version}  requires ${ref}: ${r.requires}\n`);
  }

  process.stdout.write(`\n${bold("Page")}\n  ${REGISTRY}/pages/${slug}\n`);
}

// ------------------------------------------------------------
// version: bump package.json
// ------------------------------------------------------------

function cmdVersion(args) {
  const cwd = process.cwd();
  const pkgPath = path.join(cwd, "package.json");
  if (!fs.existsSync(pkgPath)) {
    die(`no package.json in ${cwd}. Run this command from a package source directory.`);
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  } catch (err) {
    die(`failed to parse package.json: ${err.message}`);
  }
  if (args.length === 0) {
    usage("usage: adompkg version <patch|minor|major|premajor|preminor|prepatch|prerelease|x.y.z>");
  }
  const kind = args[0];
  const current = manifest.version || "0.0.0";
  let next;
  try {
    next = bumpSemver(current, kind);
  } catch (err) {
    die(err.message, EXIT_USAGE);
  }
  manifest.version = next;
  fs.writeFileSync(pkgPath, JSON.stringify(manifest, null, 2) + "\n");
  process.stdout.write(`${current} -> ${next}\n`);
}

// ------------------------------------------------------------
// link / unlink: symlink local source into the modules tree.
// ------------------------------------------------------------


// ------------------------------------------------------------
// Help: per-command help table + 'help <cmd>' dispatch.
// Also enables '-h' / '--help' anywhere in a command's args.
// ------------------------------------------------------------

const HELP_TEXT = {
  vouch: `adompkg vouch <owner>/<slug>

Vouch that you trust a package — a community-trust signal shown on its page.
Requires auth (ADOMPKG_TOKEN or a mounted container key). You cannot vouch for
your own or your org's packages.

  adompkg vouch adom/core           add your vouch
  adompkg vouch --remove adom/core  retract it`,
  doctor: `adompkg doctor

Install diagnostic. Checks the things a new user might worry about:
  - ~/.local/bin is on PATH
  - adompkg binary is at the expected location
  - auth token is available (container API key or ADOMPKG_TOKEN)
  - modules dir exists, .installed.json parses
  - sh-helpers script is materialized + valid
  - update-check hook is wired in ~/.claude/settings.json
  - adom-wiki-discover skill is installed
  - registry is reachable

Pass/warn/fail per check with a one-line fix hint when relevant. Exits
non-zero if any check fails (warnings don't fail the exit code).`,

  "sh-helpers": `adompkg sh-helpers

Print the absolute path to a bash helper file that defines
\`adompkg-link-bin\` and \`adompkg-link-skill\`. Source it from your
install.sh so you don't have to remember the ln -sfn boilerplate, and
the Adom symlink convention (install targets are symlinks back into
~/project/adom_modules/<slug>/) is followed automatically.

Example install.sh for an app:

  #!/bin/bash
  set -euo pipefail
  source "$(adompkg sh-helpers)"
  adompkg-link-bin adom-mouser

Example install.sh for a skill:

  #!/bin/bash
  set -euo pipefail
  source "$(adompkg sh-helpers)"
  adompkg-link-skill adom-mouser`,

  link: `adompkg link <owner>/<slug> [<path>]

Point an installed package at a local dev checkout instead of the extracted
tarball. Swaps the trunk symlink at ~/project/adom_modules/<slug>/ to
point at <path> (defaults to cwd). Because every install target (binary
on PATH, ~/.claude/skills/<slug>/, etc.) was created as a symlink INTO
the modules dir, downstream targets follow automatically — no separate
relinking needed.

The previous extracted tree is moved to ~/project/adom_modules/.link-stash/
so 'adompkg unlink' can restore it without re-downloading.

The path must contain a package.json whose slug matches the argument.
Refuses to mis-route otherwise.

Example dev loop:
  cd ~/work/adom-mouser
  adompkg link adom-mouser
  # edit files; binaries on PATH and skills in ~/.claude/skills/ now
  # reflect your dev checkout immediately.

Use 'adompkg unlink adom-mouser' to revert.`,

  unlink: `adompkg unlink <owner>/<slug>

Restore an 'adompkg link'-ed package to its real install. Removes the
symlink at ~/project/adom_modules/<slug>/ and, if available, restores
the previous extracted tree from ~/project/adom_modules/.link-stash/.

If no stash is available, you'll need to run 'adompkg install <slug>'
to reinstall.`,

  why: `adompkg why <owner>/<slug>

Explain why a package is installed by walking the dependency graph BACKWARDS.
Shows each parent package that depends on <slug>, recursing all the way up
to root packages (the ones nothing else depends on). Roots are marked
"(root)"; duplicate subtrees collapse to "(see above)"; dev installs carry
a "[dev]" marker.

Example:
  $ adompkg why adom-lbr
  adom-lbr@0.1.4
  ├── adom-symbol@0.1.6 (root)
  └── adom-footprint@0.1.6 (root)`,

  add: `adompkg add <owner>/<slug>[@version] [...] [--dev|-D|--peer|-P] [--org <slug>]

Edit the local package.json AND install the package(s). Packages are
identified by <owner>/<slug> (a bare <slug> works if globally unique).
Defaults to "dependencies"; --dev writes to devDependencies; --peer writes to
peerDependencies. All three sections install locally so you can develop
against them; the peer section is just metadata for downstream consumers.

If the published package declares scope="dev", a bare 'adompkg add' routes
to devDependencies automatically.

Examples:
  adompkg add adom/mouser              # latest -> dependencies, installed
  adompkg add adom/mouser@^2.0.0       # explicit spec
  adompkg add adom/style-guide -D      # devDependency
  adompkg add adom/symbol -P           # peerDependency (host you augment)

Flags:
  --dev, -D         write to devDependencies and install with --dev
  --peer, -P        write to peerDependencies
  --org <slug>      install from a specific org's package namespace`,

  install: `adompkg install [<owner>/<slug>[@version] ...] [--org <slug>] [--dev]

Install one or more packages from the registry. Packages are identified by
<owner>/<slug> (e.g. adom/core); a bare <slug> still works if it's globally
unique. With no arguments, reinstalls everything in .installed.json (handy for
migrating modules between machines).

Examples:
  adompkg install adom/core
  adompkg install adom/mouser@1.4.2
  adompkg install adom/mouser@^1.4.0
  adompkg install adom/mouser john/jlcpcb
  adompkg install mouser            # bare slug (resolves if unique)
  adompkg install                # reinstall everything in .installed.json
  adompkg install adom/mouser --dev   # also install root devDependencies

Flags:
  --org <slug>      install from a specific org's package namespace
  --dev, -D         also resolve the root packages' devDependencies. npm-shaped:
                    transitive devDeps of dependencies are NEVER walked, only the
                    direct devDependencies of the packages you ask for

Lifecycle hooks (defined in the installed package's package.json "scripts"):
  postinstall       runs inside the installed module directory after install.sh
                    succeeds. Use for setup, asset compilation, registration.
                    Non-zero exit unwinds the install.

Optional dependencies are tolerated: if install.sh / postinstall / extraction
fails for a slug declared in optionalDependencies, the failure is logged and
the install continues.`,

  uninstall: `adompkg uninstall <owner>/<slug> [--force] [--no-prune] [--prune]

Remove a package and (for non-meta packages) prune now-orphan dependencies.
Refuses to remove a package that other installed packages still depend on
unless --force is set.

Flags:
  --force           remove even if other packages depend on it
  --no-prune        do not remove orphaned dependencies
  --prune           force prune even for meta packages (default: keep)`,

  bootstrap: `adompkg bootstrap [<meta-slug>]

Thin alias for 'adompkg install <meta-slug>'. Defaults to adom-core when
no slug is passed. Kept for back-compat with the original bootstrap
flow; new code should just call 'adompkg install <meta-slug>' directly.

A bootstrap package is any wiki package of type "bootstrap" — a curated
dep list that sets up a role's worth of tooling in one shot. Examples:
  adompkg bootstrap                 # adom/core (standard set)
  adompkg bootstrap acme/baseline   # a private org-owned baseline`,

  list: `adompkg list

List installed packages and their versions, types, owning orgs, and number of
declared dependencies.`,

  outdated: `adompkg outdated [--json] [--quiet|-q]

Check installed packages for available updates. Compares installed versions
against the registry's latest.

Flags:
  --json     output JSON: {"outdated": [{slug, installed, latest}, ...]}
  --quiet    one-liner summary, exit 1 if anything is outdated (for hooks)`,

  update: `adompkg update [<owner>/<slug> ...] [--org <slug>]

Resolve and install the latest versions of one or more installed packages.
With no arguments, updates everything installed.

Examples:
  adompkg update                 # update all installed packages
  adompkg update adom/mouser     # update one package`,

  publish: `adompkg publish [--version <v>] [--org <slug>] [--tag <t>] [--private|--public] [--no-source] [--yes|-y]

Build a tarball from the current directory and POST it to the registry. The
package is owned by <owner>/<slug>: the owner is your username, or the org
passed via --org (or chosen at the interactive "Publish as" prompt).

The current directory must contain a package.json with at minimum:
  slug, version, type, description, dependencies

For 'app' and 'skill' types, install.sh and uninstall.sh are also required.

Multi-platform: set "platform" in package.json to ship a per-OS build —
one of windows | macos | linux (omit, or "any", for a cross-platform build).
The same page can host several platforms at the same version (windows + macos
@1.4.0) and independent per-platform version streams (linux@1.4.0 while windows
is still 1.3.0). 'adompkg install' auto-detects the host and fetches its build,
falling back to an 'any' build, else erroring with the platforms that exist.

Interactive prompts (TTY only — skipped with --yes, in non-TTY/CI, or when the
corresponding flag was already supplied):
  "Publish as"  pick your account or one of your orgs as the owner (uses
                GET /api/v1/me/orgs). Skipped when --org is passed.
  "Visibility"  public or private. Skipped when --public/--private is passed.

Visibility (on first publish only — subsequent publishes inherit the
page's existing setting):
  - public  (default): anyone can install and view the wiki page
  - private + --org X: only members of org X can install / view
  - private (no org): only the author can install / view

Use --no-source if you don't want your project tree pushed to the wiki
page's git repo (the tarball still uploads — installs still work — but
the Files tab stays minimal). Useful for proprietary apps whose code
should not be browseable.

Flags:
  --version <v>     override the version in package.json for this publish
  --org <slug>      publish into an org namespace (requires membership); the
                    org becomes the package owner. Skips the "Publish as" prompt.
  --tag <t>         apply a dist-tag (latest / beta / next / custom). Defaults
                    to 'latest' for non-prerelease versions.
  --private         create the page as private (first-publish only)
  --public          create the page as public (first-publish only; default)
  --no-source       skip the post-publish source push to the page git repo
  --no-glb          components: skip the automatic STEP→GLB conversion
  --yes, -y         non-interactive: never prompt, use flags/defaults

Lifecycle hooks (defined in package.json's "scripts" object):
  prepublish        runs in the project dir before any network or tarball
                    work. Use for code-gen, builds, asset generation. Non-
                    zero exit aborts the publish.

Requires authentication. Container API key (/var/run/adom/api-key) should be picked up automatically. Set ADOMPKG_TOKEN to override.`,

  pack: `adompkg pack [--out <file>]

Build the publishable tarball locally without uploading. Useful for
inspecting what would be published.

Flags:
  --out <file>      write the tarball to <file> (default: <slug>-<version>.tgz)`,

  ci: `adompkg ci [--frozen]

Clean reinstall every package listed in .lock.json. Errors if --frozen and
no lock file is present. Intended for repeatable CI environments.`,

  audit: `adompkg audit [--layout]

Report any installed package that has been deprecated upstream. Exits non-zero
if any deprecations are found.

With --layout, instead reports whether install targets (binaries in
~/.local/bin or /usr/local/bin, skills in ~/.claude/skills/) are symlinks
back into ~/project/adom_modules/<slug>/ (the Adom convention) or real
copies (drift). Use this to spot packages whose install.sh used cp
instead of ln -sfn — those edits-in-modules-dir won't take effect and
reinstalls will clobber any in-place fixes.

Flags:
  --layout         report symlink-vs-copy status of install targets`,

  search: `adompkg search <query>

Search the wiki's FTS index across titles, briefs, READMEs, and tags.`,

  info: `adompkg info <owner>/<slug> [--org <slug>]

Show the latest manifest plus dist-tags and version history for a package.
For deeper detail (including reverse-deps and tarball size), use 'adompkg view'.`,

  view: `adompkg view <owner>/<slug>[@version] [--org <slug>]

Show the full manifest, all published versions, dist-tags, integrity SHA,
tarball size, deprecation status, dependencies, and reverse-dependencies.`,

  "dist-tag": `adompkg dist-tag add <owner>/<slug>@<version> <tag>
adompkg dist-tag rm <owner>/<slug> <tag>
adompkg dist-tag ls <owner>/<slug>

Manage dist-tags (pointers from a tag name to a concrete version).

Examples:
  adompkg dist-tag add adom/my-tool@1.4.2 latest
  adompkg dist-tag add adom/my-tool@2.0.0-beta.1 beta
  adompkg dist-tag ls adom/my-tool`,

  deprecate: `adompkg deprecate <owner>/<slug>@<version> "message"

Mark a specific version as deprecated. The message is shown by 'install' and
'audit'. Empty message clears the deprecation.

Examples:
  adompkg deprecate adom/my-tool@1.0.0 "Use 2.x — 1.x is end-of-life"
  adompkg deprecate adom/my-tool@1.0.0 ""    # un-deprecate`,

  platform: `adompkg platform <owner>/<slug>@<version> <platform> [--from <p>]

Retroactively re-tag a published release's platform (owner/admin). Use it to
classify existing builds by OS without re-publishing — e.g. mark an 'any'
release as the windows build. platform: windows | macos | linux | any.
--from (default 'any') picks which existing build to re-tag when a version has
several. The tarball bytes, hash, and signature are unchanged — only the
platform label + filename. You can't re-tag onto a platform that version
already has a build for.

Examples:
  adompkg platform adom/adom-desktop@1.7.10 windows
  adompkg platform adom/adom-desktop@1.7.10 macos --from any`,

  release: `adompkg release <upload|list> <owner>/<slug>@<version> [...]

Manage downloadable RELEASE ASSETS — raw binaries (.exe/.dmg/.msi/...) a user
downloads directly (no untar), kept OUT of git in a content-addressed blob
store. Distinct from the package tarball ('adompkg install') and the source
repo. You can also declare them in package.json ("assets": ["dist/app.exe"])
and 'adompkg publish' uploads them for you.

  upload  <owner>/<slug>@<version> <file...> [--platform windows|macos|linux]
          attach binaries to a release (platform auto-detected from the name)
  list    <owner>/<slug>@<version>
          list a release's assets with size + download counts

Examples:
  adompkg release upload adom/adom-desktop@1.7.10 dist/Adom-Desktop-Setup.exe
  adompkg release list adom/adom-desktop@1.7.10`,

  whoami: `adompkg whoami

Print the currently authenticated user (name, email, ID, and orgs). Exits
non-zero if no token is configured.`,

  init: `adompkg init <slug> [--type app|skill|bootstrap] [--description "..."] [--needs-sudo] [--yes]

Scaffold a new package source directory. Without --yes, prompts for the
missing fields interactively.

Examples:
  adompkg init my-tool
  adompkg init my-skill --type skill --yes
  adompkg init my-bundle --type bootstrap --description "Curated bundle" --yes`,

  images: `Adding images & video to your page (hero + screenshots)

Every page is a git repo; images live as committed files in it. To show them:

1. PUT THE IMAGE IN THE REPO. Pick ONE binary-safe method:
   - Easiest: keep images in your project dir and run 'adompkg publish'
     (the default --source push commits your tree, images and all).
   - Or 'git push' straight to the page repo (git stores binary natively).
   - Or the upload API (multipart — binary-safe, up to 100MB):
       curl -F "file=@hero.png;filename=hero.png" \\
         <registry>/api/v1/pages/<slug>/files -H "Authorization: Bearer <tok>"
   BINARIES must go via multipart (above) or a release tarball ('adompkg
     publish'). The base64-in-JSON form is for SMALL text/assets only — the
     JSON body is capped at 4MB, so a large binary base64'd into JSON is
     rejected (and may surface as a 502). Small-asset JSON form:
       {"files":[{"path":"hero.png","content":"<base64>","encoding":"base64"}]}
   WARNING: Never put raw binary bytes in a JSON string "content" without
     encoding:"base64" — it gets utf8-mangled and the image renders broken.

2. SET THE HERO in page.json (shown big at the top of the Overview):
       "hero": { "type": "image", "path": "hero.png" }
   Use "type":"video" with an .mp4/.webm path for a video hero.

3. EMBED SCREENSHOTS in README.md with relative paths — they resolve to the
   page's files automatically:
       ![Main view](main-view.png)

Supported: png, jpg, gif, webp, svg (images); mp4, webm (video hero).
After uploading, the page reindexes automatically.`,

  version: `adompkg version <bump>

Bump the version in package.json and write the new version back. The bump
argument can be one of:
  patch        1.2.3   -> 1.2.4
  minor        1.2.3   -> 1.3.0
  major        1.2.3   -> 2.0.0
  premajor     1.2.3   -> 2.0.0-beta.0
  preminor     1.2.3   -> 1.3.0-beta.0
  prepatch     1.2.3   -> 1.2.4-beta.0
  prerelease   1.2.3-beta.0 -> 1.2.3-beta.1
               1.2.3        -> 1.2.4-beta.0
  <semver>     explicit value, e.g. 1.5.0`,

  help: `adompkg help [<command>]

Show top-level help, or detailed help for a specific command.`,
};

function helpFor(cmd) {
  return HELP_TEXT[cmd] || null;
}

function cmdHelp(args) {
  const positional = args.filter(a => !a.startsWith("-"));
  if (positional.length === 0) {
    printHelp();
    return;
  }
  const sub = positional[0];
  const txt = helpFor(sub);
  if (!txt) {
    process.stderr.write(`adompkg: no help for '${sub}'. Run 'adompkg help' for the command list.\n`);
    process.exit(EXIT_USAGE);
  }
  process.stdout.write(txt + "\n");
}

// If a command was invoked with -h / --help anywhere in its args, print the
// help text for that command and exit 0. Returns true if it handled the args.
function handleInlineHelp(cmd, args) {
  if (!args.some(a => a === "-h" || a === "--help")) return false;
  const txt = helpFor(cmd);
  if (txt) {
    process.stdout.write(txt + "\n");
  } else {
    printHelp();
  }
  process.exit(EXIT_OK);
}

// ------------------------------------------------------------
// Dispatcher
// ------------------------------------------------------------

function printHelp() {
  process.stdout.write(`adompkg ${VERSION}

USAGE
  adompkg <command> [args...]

PRIMARY
  install     install packages (with deps)
  add         add slug to local package.json + install (npm-style)
  uninstall   remove a package and its orphan deps
  publish     publish current dir to the registry
  list        list installed packages
  why         trace why a package is installed (reverse dep walk)
  link        point an installed slug at a local dev checkout
  unlink      restore a linked slug to its real install

REGISTRY
  search      search the wiki
  info        package info (description, deps, versions)
  view        full package metadata (npm-style)
  outdated    show packages with available updates
  update      install latest versions
  vouch       vouch that you trust a package (--remove to retract)

PUBLISHING
  init        scaffold a new package source directory
  pack        build tarball locally without uploading
  version     bump version in package.json
  dist-tag    manage release tags (latest, beta, ...)
  deprecate   mark a version as deprecated

ADMIN
  audit       check installed packages for deprecation
  ci          clean reinstall from .lock.json
  bootstrap   install adom-core meta-package
  whoami      show current Carbon user
  doctor      install diagnostic (PATH, token, hooks, registry)
  sh-helpers  print path to bash helpers (source from install.sh)

PAGE OPS
  create        create a wiki page + git repo
  push          commit files to a page's repo
  log           show a page's commit history
  status        page status (type, version, releases, visibility)
  delete        delete a page you own (--confirm [--owner <owner>])
  verify        verify an installed package's integrity + signature
  health        registry health check
  secrets-list  list secret keys configured for a package

HELP
  help [cmd]      detailed help; 'adompkg help install' etc.
  <cmd> --help    same, inline
  --version       print adompkg version

ENVIRONMENT
  ADOMPKG_REGISTRY  override default wiki URL (default ${REGISTRY})
  ADOMPKG_PREFIX    modules location (default ${PREFIX})
  ADOMPKG_TOKEN     bearer token; overrides /var/run/adom/api-key
  ADOMPKG_ORG       default --org slug

FULL DOCS
  ${REGISTRY}/docs
`);
}

// ── Git-style page operations (parity with the deprecated adom-wiki-publish) ──

// Create a wiki page + git repo. Mirrors `POST /api/v1/pages`.
async function cmdCreate(args) {
  let { value: type, rest } = pickFlag(args, "--type");
  let r; r = pickFlag(rest, "--brief"); const brief = r.value; rest = r.rest;
  r = pickFlag(rest, "--readme"); const readmeFile = r.value; rest = r.rest;
  r = pickFlag(rest, "--skill-md"); const skillFile = r.value; rest = r.rest;
  r = pickFlag(rest, "--visibility"); const visibility = r.value; rest = r.rest;
  const slug = rest[0];
  if (!slug || !type || !brief) {
    usage('usage: adompkg create <slug> --type <skill|app|component|bootstrap> --brief "<one-liner>" [--readme <file>] [--skill-md <file>] [--visibility public|private]');
  }
  const body = { slug, type, version: "1.0.0", title: slug, brief };
  if (readmeFile) body.readme = fs.readFileSync(readmeFile, "utf8");
  if (type === "app") body.install = { binary_name: slug };
  if (visibility) body.visibility = visibility;

  const resp = await httpJson(`${REGISTRY}/api/v1/pages`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  process.stdout.write(`Created ${type}/${slug}${resp.page?.id ? ` (id ${resp.page.id})` : ""}\n`);

  if (skillFile) {
    const content = fs.readFileSync(skillFile, "utf8");
    await httpJson(`${REGISTRY}/api/v1/pages/${encodeURIComponent(slug)}/files`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: [{ path: "SKILL.md", content }], message: `Add SKILL.md for ${slug}` }),
    });
    process.stdout.write(`Committed SKILL.md\n`);
  }
  process.stdout.write(`Page: ${REGISTRY}/pages/${slug}\n`);
  process.stdout.write(`Next: ${dim(`adompkg push ${slug} --files ... -m "..."`)} then ${dim("adompkg publish")} when ready.\n`);
}

// Commit files (text + binary) to a page's repo. Mirrors `POST .../files`.
// Binary files are base64-encoded; the wiki scans text files for secrets.
async function cmdPush(args) {
  let f = pickMultiFlag(args, "--files"); const fileArgs = f.values; let rest = f.rest;
  let a = pickMultiFlag(rest, "--allow-secret"); const allowSecret = a.values; rest = a.rest;
  let m = pickFlag(rest, "-m"); let message = m.value; rest = m.rest;
  if (!message) { const ml = pickFlag(rest, "--message"); message = ml.value; rest = ml.rest; }
  const ck = pickBoolFlag(rest, "--check"); const check = ck.value; rest = ck.rest;
  const slug = rest[0];
  if (!slug || fileArgs.length === 0) {
    usage('usage: adompkg push <slug> --files <f...> -m "<message>" [--check] [--allow-secret <substr>...]');
  }
  if (!message) message = `Update ${fileArgs.length} file(s)`;

  // Read each file + scan text for secrets. Binaries upload AS-IS through the
  // multipart path (binary-safe, 100MB cap) — never base64-in-JSON, which the
  // server caps at 4MB and which surfaced large .exe uploads as a confusing
  // 502 (June 2026 feedback). Text files ride the same multipart body.
  const parts = []; // { name, buf, binary }
  for (const fp of fileArgs) {
    const buf = fs.readFileSync(fp);
    const name = path.basename(fp);
    const binary = looksBinary(name, buf);
    if (!binary) {
      const secrets = scanTextForSecrets(buf.toString("utf8"), allowSecret);
      if (secrets.length) {
        process.stderr.write(`${red("BLOCKED")}: possible secret(s) in ${fp}:\n`);
        for (const s of secrets) process.stderr.write(`  line ${s.line}: [${s.name}] ${s.excerpt}\n`);
        process.stderr.write(`Suppress: add \`# ${ALLOW_SECRET_PRAGMA}\` on the line, or pass --allow-secret <substring>.\n`);
        process.exit(EXIT_ERR);
      }
    }
    parts.push({ name, buf, binary });
  }

  if (check) {
    process.stdout.write(`${grn("Check passed")}: ${parts.length} file(s) ready (no upload).\n`);
    return;
  }

  // Large binaries are usually better shipped as an installable release tarball.
  const bigBinary = parts.find(p => p.binary && p.buf.length > 10 * 1024 * 1024);
  if (bigBinary) {
    process.stderr.write(`${yel("note")}: ${bigBinary.name} is a large binary — for an installable artifact, ship it in a release tarball via 'adompkg publish' rather than a raw file push.\n`);
  }

  const form = new FormData();
  form.append("message", message);
  for (const p of parts) form.append("files", new Blob([p.buf]), p.name);

  const url = `${REGISTRY}/api/v1/pages/${encodeURIComponent(slug)}/files`;
  let res;
  // No explicit Content-Type — fetch sets multipart/form-data with the boundary.
  try {
    res = await fetch(url, { method: "POST", body: form, headers: authHeaders() });
  } catch (err) {
    die(describeFetchError(err, url));
  }
  const text = await res.text();
  if (!res.ok) {
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = { error: text }; }
    const base = parsed.error || `HTTP ${res.status} ${res.statusText}`;
    die(parsed.hint ? `${base}\n  hint: ${parsed.hint}` : base);
  }
  let resp; try { resp = JSON.parse(text); } catch { resp = {}; }
  process.stdout.write(`Pushed ${resp.files_count} file(s) to ${slug}${resp.commit ? ` (${String(resp.commit).slice(0, 8)})` : ""}\n`);
  if (resp.hint) process.stdout.write(`  hint: ${resp.hint}\n`);
}

// Commit history for a page. Mirrors `GET .../log`.
async function cmdLog(args) {
  let { value: limit, rest } = pickFlag(args, "--limit");
  const slug = rest[0];
  if (!slug) usage("usage: adompkg log <slug> [--limit N]");
  const qs = limit ? `?limit=${encodeURIComponent(limit)}` : "";
  const r = await httpJson(`${REGISTRY}/api/v1/pages/${encodeURIComponent(slug)}/log${qs}`);
  const commits = r.log || [];
  if (commits.length === 0) { process.stdout.write("(no commits)\n"); return; }
  for (const c of commits) {
    const when = c.timestamp ? new Date(c.timestamp * 1000).toISOString().slice(0, 10) : "";
    process.stdout.write(`${dim(String(c.hash || "").slice(0, 8))}  ${when}  ${(c.author || "").padEnd(16)}  ${c.message || ""}\n`);
  }
}

// Soft-delete a page. Mirrors `DELETE /api/v1/pages/:slug`. Requires --confirm.
async function cmdDelete(args) {
  const cf = pickBoolFlag(args, "--confirm");
  const hf = pickBoolFlag(cf.rest, "--hard");
  const ownerFlag = pickFlag(hf.rest, "--owner");
  const orgFlag = pickFlag(ownerFlag.rest, "--org");
  const ref = orgFlag.rest[0];
  if (!ref) usage("usage: adompkg delete <[owner/]slug> --confirm [--hard] [--owner <owner>]");
  if (!cf.value) die("refusing to delete without --confirm. Re-run with --confirm.", EXIT_USAGE);
  // Disambiguate a slug that exists under multiple owners: an owner-qualified
  // ref or an explicit --owner/--org maps to the server's ?owner= filter.
  // Without this, deleting an ambiguous slug 409'd with no way to qualify, and
  // passing owner/slug got percent-encoded into a single unmatched segment.
  // --hard permanently removes the row + repo + tarballs (frees the slug to be
  // recreated); default is a reversible soft delete.
  const parsed = splitRef(ref);
  const owner = ownerFlag.value || orgFlag.value || parsed.owner;
  const slug = parsed.owner ? parsed.slug : ref;
  const params = [];
  if (owner) params.push(`owner=${encodeURIComponent(owner)}`);
  if (hf.value) params.push("hard=true");
  const qs = params.length ? `?${params.join("&")}` : "";
  const r = await httpJson(`${REGISTRY}/api/v1/pages/${encodeURIComponent(slug)}${qs}`, { method: "DELETE" });
  process.stdout.write(`${r.message || `Deleted ${slug}`}\n`);
  if (r.dependent_count) process.stderr.write(`${yel("WARNING:")} ${r.warning || `${r.dependent_count} dependent(s) now unresolved`}\n`);
}

// Page status: type, version, releases, commit count, visibility.
async function cmdStatus(args) {
  const { value: asJson, rest } = pickBoolFlag(args, "--json");
  const slug = rest[0];
  if (!slug) usage("usage: adompkg status <slug> [--json]");
  const seg = encodeURIComponent(slug);
  const pageResp = await httpJson(`${REGISTRY}/api/v1/pages/${seg}`);
  const page = pageResp.page || pageResp;
  let releases = [];
  try { releases = (await httpJson(`${REGISTRY}/api/v1/pages/${seg}/releases`)).releases || []; } catch {}
  let commits = [];
  try { commits = (await httpJson(`${REGISTRY}/api/v1/pages/${seg}/log?limit=1000`)).log || []; } catch {}

  const status = {
    slug: page.slug, type: page.type, owner: page.owner || null, version: page.version || null,
    visibility: page.visibility || "public", releases: releases.length,
    latest_release: releases[0]?.version || null, commits: commits.length, updated_at: page.updated_at || null,
  };
  if (asJson) { process.stdout.write(JSON.stringify(status, null, 2) + "\n"); return; }
  process.stdout.write(`${bold(status.owner ? `${status.owner}/${status.slug}` : status.slug)} (${status.type})\n`);
  process.stdout.write(`  page version: ${status.version || dim("(none)")}\n`);
  process.stdout.write(`  releases:     ${status.releases}${status.latest_release ? ` (latest ${status.latest_release})` : ""}\n`);
  process.stdout.write(`  commits:      ${status.commits}\n`);
  process.stdout.write(`  visibility:   ${status.visibility}\n`);
  if (status.releases === 0) process.stdout.write(`  ${yel("No release yet")} — run 'adompkg publish' to make it installable.\n`);
}

// Best-effort screenshot of a wiki page, native-Hydrogen first, then adom-desktop.
function which(bin) { try { execFileSync("which", [bin], { stdio: "ignore" }); return true; } catch { return false; } }
function tryScreenshot(slug) {
  const url = `${REGISTRY}/pages/${slug}`;
  try {
    if (which("adom-desktop")) {
      execFileSync("adom-desktop", ["browser_open_window", url], { stdio: "ignore" });
      const out = `/tmp/verify-${slug}.png`;
      execFileSync("adom-desktop", ["browser_screenshot", "--output", out], { stdio: "ignore" });
      process.stdout.write(`  screenshot: ${out}\n`);
    } else if (which("adom-cli")) {
      process.stdout.write(`  ${dim(`tip: open ${url} in a Hydrogen webview and run 'adom-cli hydrogen screenshot' to capture it`)}\n`);
    } else {
      process.stdout.write(`  ${dim(`open ${url} to verify visually`)}\n`);
    }
  } catch {
    process.stdout.write(`  ${dim("(screenshot skipped)")}\n`);
  }
}

// Post-publish verification: page/README/hero/release checks + best-effort shot.
async function cmdVerify(args) {
  const slug = args[0];
  if (!slug) usage("usage: adompkg verify <slug>");
  const seg = encodeURIComponent(slug);
  const checks = [];
  let page = null;
  try { const r = await httpJson(`${REGISTRY}/api/v1/pages/${seg}`); page = r.page || r; checks.push(["page exists", true]); }
  catch { checks.push(["page exists", false]); }
  if (page) checks.push(["hero image set", !!(page.hero_path || page.hero_thumbnail)]);
  let releases = [];
  try { releases = (await httpJson(`${REGISTRY}/api/v1/pages/${seg}/releases`)).releases || []; } catch {}
  checks.push(["has a published release", releases.length > 0]);
  let readmeOk = false;
  try { readmeOk = (await fetch(`${REGISTRY}/api/v1/pages/${seg}/files/README.md`, { headers: authHeaders() })).ok; } catch {}
  checks.push(["README present", readmeOk]);

  let allOk = true;
  for (const [name, ok] of checks) {
    process.stdout.write(`  [${ok ? grn("PASS") : red("FAIL")}] ${name}\n`);
    if (!ok) allOk = false;
  }
  tryScreenshot(slug);
  if (!allOk) die(`verify: some checks failed for ${slug}`, EXIT_ERR);
  process.stdout.write(`${grn("OK")}: ${slug} verified.\n`);
}

// List the secret-scanner patterns adompkg enforces on push/publish.
function cmdSecretsList() {
  process.stdout.write("Secret-scanner patterns enforced on push/publish:\n");
  for (const p of SECRET_PATTERNS) process.stdout.write(`  [${p.name}]  ${p.scope}: ${p.re.source}\n`);
  process.stdout.write(`\nSuppress one line with ${dim("# adom-wiki-publish: allow-secret")}, or pass ${dim("--allow-secret <substring>")} to push.\n`);
}

// Version + connectivity.
async function cmdHealth() {
  process.stdout.write(`adompkg ${VERSION}\n`);
  try {
    const h = await httpJson(`${REGISTRY}/health`);
    process.stdout.write(`registry ${REGISTRY}: ${grn(h.status || "ok")}${h.version ? ` (v${h.version})` : ""}\n`);
  } catch (err) {
    process.stdout.write(`registry ${REGISTRY}: ${red("unreachable")} (${err.message})\n`);
  }
}

async function main() {
  const args = normalizeEqualsFlags(process.argv.slice(2));
  if (args.length === 0) {
    printHelp();
    return;
  }
  if (args[0] === "--help" || args[0] === "-h") {
    printHelp();
    return;
  }
  if (args[0] === "help") {
    cmdHelp(args.slice(1));
    return;
  }
  if (args[0] === "--version" || args[0] === "-v") {
    process.stdout.write(`adompkg ${VERSION}\n`);
    return;
  }
  const cmd = args[0];
  // Global opt-in flags are read straight from process.argv where needed; drop
  // them here so per-command parsers don't see them as positionals.
  const GLOBAL_FLAGS = new Set(["--allow-sudo", "--allow-unsigned", "--ignore-scripts"]);
  const rest = args.slice(1).filter(a => !GLOBAL_FLAGS.has(a));

  // Inline help: `adompkg <cmd> --help` / `-h` prints that command's help.
  // Exception: `adompkg version` is itself a command, not a help-only flag,
  // so don't intercept --version there.
  if (cmd !== "version") {
    handleInlineHelp(cmd, rest);
  }

  try {
    switch (cmd) {
      case "install":   await cmdInstall(rest); break;
      case "add":       await cmdAdd(rest); break;
      case "uninstall": await cmdUninstall(rest); break;
      case "why":       cmdWhy(rest); break;
      case "link":      cmdLink(rest); break;
      case "unlink":    cmdUnlink(rest); break;
      case "sh-helpers":cmdShHelpers(); break;
      case "doctor":    await cmdDoctor(); break;
      case "bootstrap": await cmdBootstrap(rest); break;
      case "list":      cmdList(); break;
      case "outdated":  await cmdOutdated(rest); break;
      case "update":    await cmdUpdate(rest); break;
      case "publish":   await cmdPublish(rest); break;
      case "pack":      await cmdPack(rest); break;
      case "ci":        await cmdCi(rest); break;
      case "audit":     await cmdAudit(rest); break;
      case "search":    await cmdSearch(rest); break;
      case "info":      await cmdInfo(rest); break;
      case "view":      await cmdView(rest); break;
      case "dist-tag":  await cmdDistTag(rest); break;
      case "deprecate": await cmdDeprecate(rest); break;
      case "platform":  await cmdPlatform(rest); break;
      case "release":   await cmdRelease(rest); break;
      case "vouch":     await cmdVouch(rest); break;
      case "whoami":    await cmdWhoami(); break;
      case "create":    await cmdCreate(rest); break;
      case "push":      await cmdPush(rest); break;
      case "log":       await cmdLog(rest); break;
      case "delete":    await cmdDelete(rest); break;
      case "status":    await cmdStatus(rest); break;
      case "verify":    await cmdVerify(rest); break;
      case "secrets-list": await cmdSecretsList(); break;
      case "health":    await cmdHealth(); break;
      case "init":      await cmdInit(rest); break;
      case "version":   cmdVersion(rest); break;
      default:
        die(`unknown command: '${cmd}'. Run 'adompkg help' for the command list.`, EXIT_USAGE);
    }
  } catch (err) {
    die(err.message || String(err));
  }
}

main();
