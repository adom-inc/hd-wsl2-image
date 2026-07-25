---
name: hd-recording
description: >
  How to record screen + window video from Hydrogen Desktop. In HD the recorder is
  NATIVE: Windows.Graphics.Capture (per-window, "record kicad") + DXGI full-screen,
  hardware H.264 (default, universally playable) or H.265 (smaller, not web-playable)
  → mp4 in ~/project/recordings/, with NO picker, NO "you're sharing" banner, real
  30-60fps, and NO display wake-lock. Driven by `adom-cli hydrogen recording
  start/stop` (which routes to the native control API) or the control endpoints
  directly (POST /recording/native/start|stop, GET /recording/native/status|sources).
  A server-side max-duration cap (default 600s) auto-stops + toasts. Read for codec
  choice, source selection, the cap+reason, and the "● Recording" indicator. Also
  covers AUDIO-ONLY / narration capture (`adom-cli hydrogen audio` → WebM/Opus in
  ~/project/audio/), AD host desktop recording (desktop_record_start, Windows-only),
  the tab-vs-desktop footgun, and what `--mic` does. Trigger words — record,
  recording, screen recording, record my screen, record kicad, record a window,
  record whole screen, record the workspace, record a demo, record with mic, record
  no audio, mic on, mic off, voiceover, record audio, audio-only, record a narration,
  record my voice, narrate, narration track, record a voice track, h264, h265, hevc,
  mp4, webm, opus, codec, recordings folder, audio folder, ffmpeg, stitch clips,
  max duration, recording indicator, desktop_record_start, browser_record_start,
  start recording, stop and save.
---

# Hydrogen Desktop — Screen & Window Recording

In HD the primary recorder is **native** (Windows.Graphics.Capture + DXGI) — not
`getDisplayMedia`. It produces a real high-fps mp4, asks for no permission, shows no
"you're sharing" banner, and holds **no display wake-lock** (see
[hd-screen-lock](../hd-screen-lock/SKILL.md)). Pick the mechanism by *what* you're
recording — this is the single most important decision and a known footgun.

**DEFAULT — drive it with `adom-cli hydrogen recording start` / `stop`.** That IS the
HD native recorder (h264 mp4 → `~/project/recordings/`). Do **NOT** reach for
`adom-desktop desktop_record_start` for an ordinary "record my screen / window / the
workspace" — that's the AD **host** fallback: it writes a `.webm` into AD's
bridges-cache (`…/Adom Desktop/bridges-cache/…`), **not** your `~/project/recordings/`,
and is only for when HD's native recorder is genuinely busy. "record my screen",
"record the workspace", "record a demo", "record kicad" all → `adom-cli hydrogen
recording`. (Same trap as screenshots: don't fall through to `adom-desktop` for
anything inside HD.)

## Which recorder? — the priority ladder (read first)

Same shape as [hd-self-screenshot](../hd-self-screenshot/SKILL.md): **lead with `adom-cli`
(consistent with web Hydrogen), drop to the richer HD/AD surfaces only for what it can't
do.** Default to HD-native.

1. **HD content OR the whole screen (the 99% case): `adom-cli hydrogen recording start
   --share tab|screen` — THE DEFAULT.** The *same* command on web-Hydrogen and HD (web-H
   records via `getDisplayMedia`; HD records **natively** via WGC/DXGI — no picker, no "you're
   sharing" banner, no display wake-lock). `--share tab` = the HD workspace; `--share screen`
   = the entire display (KiCad/Fusion/desktop apps). Saves **h264 mp4 → `~/project/recordings/`**.
   Verified live 2026-06-14.
2. **A SPECIFIC WINDOW** (record just KiCad / Fusion, not the whole screen): **HD native
   control API `POST /recording/native/start {source:"window:<title-substring>"}`.** adom-cli's
   `--share` is **tab|screen only — it has no per-window flag**, so per-window recording is an
   **HD-native exclusive** (neither adom-cli nor AD can scope a recording to one window).
   Resolve the title via `GET /recording/native/sources`. Same endpoint does `{source:"screen"}`,
   `{source:"screen:2"}`, codec, custom cap.
3. **The whole DESKTOP when HD's native recorder is already busy:** `adom-desktop
   desktop_record_start {confirmDesktopNotTabRecording:true}`. **Whole-desktop ONLY (no
   per-window), via Chrome `getDisplayMedia` → it DOES hold the display wake-lock** (unlike HD
   native) and writes a **`.webm` into AD's cache** (not `~/project/recordings/`). AD's own help
   says "prefer Hydrogen's `recording start --share screen`" — this is for the
   parallel-with-an-HD-capture case, not the default.
4. **A single Chrome tab** (AI-driven Pup browser — a clean per-tab clip): `adom-desktop
   browser_record_start {sessionId}` / `browser_record_stop`. CDP screencast, ~50fps, no HUD,
   no wake-lock, coexists with everything.
5. **Just audio — a voice / narration track, no video** ("record a narration", "record my
   voice"): **`adom-cli hydrogen audio start/stop`** → `~/project/audio/<name>.webm` (Opus).
   See "Audio-only" below.

### What each recorder can actually scope (don't assume symmetry with screenshots)
Unlike screenshots — where AD grabs a window *or* the screen — **recording is NOT uniform**:

| Recorder | Window | Full desktop | Browser tab | Backend | Wake-lock | Output |
|---|---|---|---|---|---|---|
| `adom-cli hydrogen recording` (HD) | — (use control API) | ✅ `--share screen` | ✅ `--share tab` | native WGC/DXGI | **NO** | mp4 → `~/project/recordings/` |
| HD native control API | ✅ `source:"window:X"` | ✅ `source:"screen"` | — | native WGC/DXGI | **NO** | mp4 → `~/project/recordings/` |
| AD `desktop_record_start` | ❌ **none** | ✅ whole desktop | ❌ | Chrome `getDisplayMedia` | **YES** | `.webm` → AD cache |
| pup `browser_record_start` | — | ❌ | ✅ one tab | CDP screencast | **NO** | tab clip |

So: **per-window recording = HD-native only; whole-desktop = HD-native (no wake-lock) preferred
over AD (wake-lock); single tab = pup.** When someone says "record a window," that's #2 (HD
control API) — AD cannot do it.

---

## (a) HD native recording (WGC + DXGI) — the default

**Mechanism:** Rust `crates/hd-control/src/recorder.rs` — Windows.Graphics.Capture
per-window + DXGI Desktop Duplication full-screen → Media Foundation hardware
encoder → mp4 in `~/project/recordings/` (born `adom`-owned). Real 30–60fps at full
source resolution. **No picker, no banner, no display wake-lock.**

### Drive it via adom-cli (the usual way)

```bash
adom-cli hydrogen recording start --share screen --mic false --countdown 0 --reason "demo"
# ... do the thing (wait / drive the app you're recording) ...
adom-cli hydrogen recording stop      # → filePath: recordings/recording-<ts>.mp4 (relative to ~/project)
```

**All four `start` flags are REQUIRED** (`--share`, `--mic`, `--countdown`, `--reason`)
— the CLI rejects the call otherwise (it forces you to think through scope, audio,
pacing, intent). `--share screen` records the whole (primary) screen with no approval
dialog (native capture); re-running `start` with the same `--share`/`--mic` skips
straight to countdown. In HD the result JSON carries fields web-Hydrogen doesn't:
`native:true`, `codec` (h264), `maxSeconds`, `reason`, `source` (e.g. `monitor:primary`),
and `pendingFile` / `filePath` (relative `recordings/<name>.mp4`).

⚠️ **The `stop` `_hint` text currently LIES about the format** — it says *"WebM format
(VP9 + Opus)"*, but HD native recordings are **h264 mp4** (the file is `.mp4`, and the
`codec` field says `h264`). Trust the `.mp4` `filePath` + `codec` field, not the hint.
(Known adom-cli bug, on Colby's list.)

### Drive it via the control API (full control — window by name, codec, cap)

The AI can call the control endpoints directly for capabilities adom-cli flags don't
yet expose (a specific window, codec, a custom cap):

```bash
# Discover sources first (resolve a fuzzy name like "kicad")
GET  /recording/native/sources         # → { windows:[...titles...], monitors:[{index,width,height}] }

# Start — source is the key arg:
POST /recording/native/start  { "source": "window:KiCad" }      # a window by title substring
POST /recording/native/start  { "source": "screen" }           # primary monitor ("record whole screen")
POST /recording/native/start  { "source": "screen:2" }         # monitor by 1-based index

POST /recording/native/stop            # → { file: "recordings/<name>.mp4", fileAbsolute, seconds, source }
GET  /recording/native/status          # → { recording, source, seconds, maxSeconds, reason, remainingSeconds }
```

So **"record kicad"** = `POST /recording/native/start {source:"window:kicad"}` (after
confirming the window title via `/sources`); **"record whole screen"** =
`{source:"screen"}`. No picker, no asking the user which window.

### Codec — H.264 (default) vs H.265

`POST /recording/native/start {"codec": "h264" | "h265"}` (default **h264**):

- **h264** — universally playable: browsers (Chrome/Edge `<video>`), the wiki, every
  player. **Use this for anything shared, embedded, or streamed.** (Default.)
- **h265 / hevc** — ~40% smaller at equal quality, BUT not playable in Chrome/Edge
  `<video>` (needs hardware/codec support). **Only for archival / local use** where
  you control the player.

When unsure, keep h264. The start response repeats this tradeoff in `_hints.codec`.
(adom-cli's `recording start` has no `--codec` flag yet — it always sends h264; use
the control API to choose h265. A `--codec` flag is on the adom-cli wishlist.)

### Audio (microphone)

`--mic true` (adom-cli) / `{"mic": true}` (control API) mixes the **default input
device** (the user's mic, via cpal/WASAPI) into the mp4's audio track (48 kHz AAC) —
for narration/voiceover. WGC is video-only, so HD opens the mic itself and feeds PCM
to the encoder. If no mic is available the recording proceeds **video-only** (graceful).
`--mic false` omits the voice. Notes:
- **`--mic false` is NOT "no audio track."** Either way the native mp4 carries an aac
  stream; with mic off it's a harmless EMPTY stream (0 frames, no audio, plays fine) —
  a windows-capture limitation, intentionally not stripped to avoid an ffmpeg
  dependency on clean VMs. There is **no recorder flag for a fully audio-free file**; if
  a user truly needs zero audio, strip it post-hoc (`ffmpeg -i in.mp4 -c copy -an out.mp4`).
- **~1s startup gap:** the audio stream begins once the encoder is created on the first
  video frame, so the mic track can be ~1s shorter than the video and slightly lead.
  Fine for casual narration; flag if you need frame-accurate sync.
- **adom-cli `_hint` bugs (Colby) — don't be misled:** the `start` hint always says
  *"No mic in this recording — pass --mic true"* even when you DID pass `--mic true`;
  and the `stop` hint says *"WebM (VP9 + Opus)"* though the file is h264 mp4. Trust the
  `.mp4` `filePath` + the `codec` field, not the hints.

### Max-duration cap + "● Recording" indicator (safety nets)

- A **`maxSeconds`** cap (default **600s / 10 min**) is enforced server-side: a
  watchdog auto-stops + finalizes the mp4 and fires a UI toast. To override, pass
  `maxSeconds` AND a **required `reason`** (e.g. `{"maxSeconds":1800,"reason":"30-min
  walkthrough the user asked for"}`) — the reason is shown in the toast when the cap
  hits. Overriding without a reason is rejected (400).
- While recording, HD shows a persistent **"● Recording · <source>"** badge so it's
  never silently on.
- HD does **not** stop on blur/minimize — recording while HD is backgrounded (to
  capture KiCad/Fusion) is the normal case. See [hd-screen-lock](../hd-screen-lock/SKILL.md).

### Taking screenshots WHILE recording (multi-AI-thread capture contention)

Adom users run several AI threads against one HD at once, so a recording started by one
thread and a screenshot requested by another routinely overlap. **Almost every capture
method coexists with a live recording — only the `adom-cli` SSE screenshot path does not.**

- ✅ **Coexist with a recording** (use these while recording): CDP `POST /screenshot`
  (HD-native, the default), `adom-desktop desktop_screenshot_window` (AD per-window),
  `adom-desktop desktop_screenshot_screen` (AD host GDI), pup `browser_screenshot`.
- ⚠️ **The ONE exception** — `adom-cli hydrogen screenshot panel|workspace|screen` (the SSE
  path, `PATCH /current/screenshot`). The moment a native recording is active this returns
  **`{ok:false, error:"capture_busy", retry_after_ms, alternatives:[...], _hint}`** instead of
  silently failing. **Don't blind-retry it — read `alternatives` and switch to a coexisting
  method** (CDP `POST /screenshot` is the drop-in).
- **Pre-flight when unsure:** `GET /capture/availability` reports `recording:{active,source}`,
  per-method reliability + `coexists_with_recording`, and a `recommended` method. Check it
  before a screenshot if you might be mid-recording.

Full screenshot routing + the coexistence matrix live in
[hd-self-screenshot](../hd-self-screenshot/SKILL.md) ("During a recording"). The takeaway for
*this* skill: **starting a recording does NOT lock out screenshots** — it only redirects the
SSE path to `capture_busy`; every other method keeps working.

## Audio-only — record a narration / voice track (`adom-cli hydrogen audio`)

When the user wants **just their voice, no video** — "record a narration track for
the video", "record my voice", "let me record some audio to narrate this" — use the
dedicated **`audio`** verb, NOT the video recorder:

```bash
adom-cli hydrogen audio enable                                  # activate mic (silent if cached)
adom-cli hydrogen audio start --countdown 0 --reason "narration for the demo video"
# ... user speaks ...
adom-cli hydrogen audio stop        # → filePath: audio/<name>.webm  (relative to ~/project)
```

- Output is a **WebM / Opus** audio file in **`~/project/audio/`** (the `audio` verb's
  WebM hint is **correct**, unlike the video recorder's). Reason is required.
- Other subcommands: `audio status` (mic active? device label), `audio level`
  (rms/peak/clipping/gain — warn if clipping), `audio gain <0.0-4.0>` (persists),
  `audio disable`.
- Audio-only files land in `audio/`; screen videos land in `recordings/`.

### Stitching / post-processing (ffmpeg) — install it on demand

A common follow-on is "stitch these clips together" or "lay this narration over the
video." **ffmpeg/ffprobe are NOT pre-installed** — the HD workspace image is
intentionally **lightweight**, and the AI adds tools as the user needs them. That's
not a blocker: when you need to concatenate clips, mux a narration `.webm` onto an
`.mp4`, transcode, or probe a file, **just install ffmpeg and proceed** (passwordless
sudo + apt are available; ffmpeg ~6.1 is in the repos):

```bash
sudo apt-get update -qq && sudo apt-get install -y ffmpeg   # pulls ffprobe too
```

Don't tell the user "ffmpeg isn't available here" — install it (a few seconds) and do
the job. Same pattern for any other missing tool (imagemagick, pandoc, …): install on
demand rather than declaring it impossible.

---

## (b) HD's in-app combined recorder (web-Hydrogen / legacy getDisplayMedia)

> **In HD this path is superseded by (a) native recording.** The
> getDisplayMedia-based combined recorder below is the **web-Hydrogen** mechanism
> (and the mic/level-meter detail still applies there). In HD, `adom-cli hydrogen
> recording` and the Recording dropdown route to the native recorder in (a).

Source: `src/lib/components/editor/EditorNav.svelte` (~L2418–2519).
Stores: `src/lib/stores/recordingStore.ts` + `src/lib/stores/audioCaptureStore.ts`.

The **Recording dropdown** in the editor toolbar records the workspace (and/or mic)
into one file.

**Sources** — you choose **Screen** and/or **Mic** (a recording needs at least one
enabled; the **Start recording** button is disabled with "Enable screen sharing or
microphone to start recording" until one is active):
- **Screen** row — shows the current share state; click to set up sharing (this
  routes through the Screen Capture share flow — see
  [hd-capture-share](../hd-capture-share/SKILL.md)).
- **Microphone** row — shows the selected device label or "Not enabled."

**While recording** the dropdown shows a **live MM:SS timer** (`recordingSeconds`),
a "Recording" status dot, and tags for the active sources (Screen / Mic), with:
- **Stop & save** — finalizes the recording.
- **Discard** — throws it away (`discardCombinedRecording()`).

**Output:** a **single `.webm`** (VP9+Opus preferred, then VP8+Opus / WebM, MP4 as
last resort). `startCombinedRecording()` muxes the screen + audio streams; **Stop &
save** finalizes and **uploads to the container's `recordings/` folder.** If the
upload fails, HD **falls back to a local browser download** named
`recording-<timestamp>.webm`.

**AI-requested auto-open:** `promptRecording(message?)` sets a prompt and the
Recording dropdown can **auto-open** so the user sees what you're asking to record
(default message: "Enable screen sharing and microphone to allow AI recording").
Store state: `{ isRecording, recordingSeconds, hasVideo, hasAudio, promptMessage }`.
API-side finalizers exist too: `stopCombinedRecordingForAPI()` (base64 data URL)
and `stopCombinedRecordingAsBlob()` (raw blob) for programmatic capture.

### Mic device picker + level/gain meter

`audioCaptureStore.ts` drives the microphone:
- **Device picker:** `enumerateAudioDevices()` lists `audioinput` devices;
  `startAudioCapture(deviceId?)` selects one; the last device persists as
  `adom:lastMicDeviceId`.
- **Level + gain meter:** the store exposes `audioLevel` (0–1 RMS), `rms`, `peak`,
  and `clipping` (peak ≥ 0.99) from an analyser node, updated ~every 50 ms — this
  is the live mic meter. **Gain** is adjustable via `setAudioGain(v)` (clamped
  **0–4**, persisted as `adom:micGain`). Watch `clipping` to warn the user their
  mic is too hot.

---

## (c) AD host desktop recording (Windows-only)

Served by the embedded **Adom Desktop** process (see
[hd-adom-desktop](../hd-adom-desktop/SKILL.md)), not by the HD frontend. These
record the **real OS desktop**, not HD's webview:

```bash
adom-desktop desktop_record_start '{"reason":"Demo recording","confirmDesktopNotTabRecording":true}'
adom-desktop desktop_record_stop
adom-desktop desktop_record_status
adom-desktop desktop_recorder_open      # open the recorder UI on the host
```

**Verify the capability first** — desktop recording is **Windows-only** and only
present when AD advertises it:

```bash
adom-desktop status   # → .capabilities must include "record"
```

If `record` isn't listed, the host/runtime doesn't support it — fall back to the
in-app recorder (for the workspace) or `browser_record_start` (for a tab).

---

## Quick reference

| Intent | Command / surface | Output |
|---|---|---|
| **Record whole screen (HD)** | `adom-cli hydrogen recording start --share screen …` or `POST /recording/native/start {source:"screen"}` | **h264 mp4** → `~/project/recordings/` |
| **Record a window (HD), e.g. "record kicad"** | `POST /recording/native/start {source:"window:KiCad"}` | **h264 mp4** → `~/project/recordings/` |
| **Smaller archival recording (HD)** | `POST /recording/native/start {source:…, codec:"h265"}` | **h265 mp4** (not web-playable) |
| Record one AI browser tab | `adom-desktop browser_record_start` (pup) | tab screencast |
| Record host desktop via AD (HD busy) | `adom-desktop desktop_record_start '{"confirmDesktopNotTabRecording":true}'` | host recording |
| Record the workspace (web-Hydrogen) | In-app Recording dropdown (or `promptRecording()`) | `.webm` → container `recordings/` |

## Related skills
- [hd-screen-lock](../hd-screen-lock/SKILL.md) — native capture holds NO display wake-lock; the max-duration cap + "● Recording" indicator
- [hd-self-screenshot](../hd-self-screenshot/SKILL.md) — native CDP screenshots (the 90% "ralph test the webview" case); the capture-contention matrix — which screenshot methods coexist with a recording and which (`adom-cli` SSE) return `capture_busy`
- [hd-capture-share](../hd-capture-share/SKILL.md) — the (web-Hydrogen) screen-share + AI-consent flow incl. the cancelable CountdownToast
- [hd-bridges](../hd-bridges/SKILL.md) — `browser_record_start` (Pup tab recording) and the AD capability list (`record`, `screenshot`, …)
- `pup` — driving the Pup browser windows you'd record per-tab
