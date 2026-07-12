# Rhythm Runner (working title)

## Development

```bash
npm install
npm run dev          # dev server → http://localhost:5180
npm run dev:audio    # yt-dlp extraction server (needed for "From YouTube"; brew install yt-dlp)
npm run build        # typecheck + production build → dist/
npm run lint         # eslint
npm run cap:android  # build web, sync into android/, open Android Studio
npm run cap:ios      # build web, sync into ios/, open Xcode
```

Playing music: Menu → Select Music → paste a YouTube URL (requires `npm run dev:audio`
running), load a local audio file, or use the silent test track. Audio is decoded and
analyzed in the browser (spectral-flux onset detection, ~150ms per minute of audio);
the level spawns from the detected beats and stays locked to the Web Audio clock.

Native build prerequisites (one-time machine setup):
- **Android**: install [Android Studio](https://developer.android.com/studio) (brings the
  SDK + emulator). The `android/` project is committed and ready.
- **iOS**: install Xcode from the App Store, then run
  `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` followed by
  `npx cap sync ios` (finishes the CocoaPods install that requires full Xcode).
  CocoaPods itself is already installed via Homebrew.

A 2D side-scrolling rhythm platformer for mobile, tablet and PC. The player picks a song,
the game generates a level from the music, and the hero auto-runs right while obstacles
arrive **in sync with the beat** — jump on the kick drum, duck under the snare.
Think *Mario* movement + *Flappy Bird* simplicity + *Geometry Dash / Audiosurf* music sync.

---

## 1. Core Concept

- Player selects a music track — YouTube URL during prototyping, AI-generated original
  tracks in production, local files always supported.
- The game analyzes the audio and produces a **beatmap**: a timestamped list of musical
  events (kicks, snares, energy rises, drops).
- The level is generated from the beatmap: every obstacle corresponds to a musical event
  and reaches the hero exactly when that event plays.
- The hero runs automatically. The player only reacts: jump, double-jump, duck, kick.
- No stopping, no moving left. Pause is the only interruption.
- High scores per track + real-time multiplayer races on the same track.

## 2. Audio Source Strategy (read first)

The whole pipeline runs on **any decoded audio buffer**: buffer → analysis → beatmap →
level. The *source* of that buffer is swappable behind one `AudioSource` interface, and
the strategy is staged:

1. **Prototype (early phases): YouTube URL → audio extraction.** Open-source extractors
   like [ytdx](https://github.com/Aveek-Saha/ytdx) (or a small server with `yt-dlp`) pull
   the audio track from a pasted YouTube URL. This is the fastest way to test the game
   against real, familiar songs.
   - *Known trade-offs:* extractors break whenever YouTube changes internals (expect
     occasional maintenance), it sits outside YouTube ToS, and **app stores will reject a
     published app that rips YouTube audio** — so this stays a development/prototyping
     feature, gated off in store builds.
2. **Production: AI-generated music.** User types a vibe or a reference ("80s hard rock
   anthem, Scorpions-style") and an AI music API (evaluate: Suno API, Stable Audio,
   Mubert, Loudly) generates an original track. We receive the audio file directly, so
   analysis is trivial, rights are clean, and every track is cacheable + shareable for
   multiplayer.
   - *Legal nuance to respect in UX:* an AI **cover of a specific song** still infringes
     the composition copyright even with a newly generated recording. The prompt UI must
     steer toward "in the style of," not "make me this exact song."
3. **Always available: local audio files** (MP3/OGG the user owns). Nearly free to
   support since it's the same buffer pipeline; useful as a fallback and for testing.

**Beatmaps are generated ahead of time, not live.** This is required regardless of
source: multiplayer fairness demands every player on a track face identical obstacles,
so level generation must be deterministic from one shared beatmap (keyed by audio hash).

## 3. Gameplay Design

### Hero abilities
| Action | Effect |
|---|---|
| Jump | Clear low obstacles / gaps |
| Double jump | Second jump mid-air, for tall obstacles or chained beats |
| Duck | Slide under overhead obstacles (hold to stay ducked) |
| Kick | Break "breakable" obstacles directly ahead |
| Move up/down | Switch between lanes/platform heights (when level offers them) |

Constant forward speed — possibly scaled to the track's BPM so faster songs feel faster.

### Obstacle catalog
| Obstacle | Valid action(s) | Notes |
|---|---|---|
| **Pit** | Jump / double jump (wide pits) | Classic gap in the ground |
| **Lava pool + firing lava stones** | Jump the pool, time it between stone volleys | Stones fire **on the beat** — the projectile rhythm *is* the musical rhythm; set-piece for intense sections |
| **Zombie** | Kick **or** jump on top (stomp) | First multi-solution obstacle; stomp gives a small bounce (can chain into the next beat), kick scores a style bonus — both valid, player expression |
| **Horizontal wall / tree branch** (overhead) | Duck | Hold to slide under long branches |
| **Breakable vertical wall** | Kick | Shatters on kick; visually cracked so it reads as breakable |
| **Hard vertical wall** | Jump / double jump only | Kick does nothing (solid look, no cracks) — forces reading the obstacle, not just reacting |

Readability rule: every obstacle must telegraph its valid action(s) by silhouette alone
(cracked = kickable, solid = jump, gap = pit), since at music speed there's no time to
think.

### Musical event → obstacle mapping
| Musical event | Spawns |
|---|---|
| Kick drum / strong low-freq onset | Pit or ground obstacle → Jump |
| Two rapid onsets | Wide pit / hard wall → Double jump |
| Snare / mid-freq onset | Branch / horizontal wall → Duck |
| Accented hit (loud transient) | Breakable wall or zombie → Kick (or stomp) |
| Sustained energy rise | Ascending platforms / lava section with beat-synced stone volleys |
| Energy drop / breakdown | Descending path / rest section → breathe |

Quiet sections produce sparse levels (recovery), intense sections produce dense ones.
A difficulty setting filters how many detected events become obstacles.

### Scoring & failure
The game is **score-attack, not survival**: a run always lasts the full song. Tension
comes from protecting your multiplier, not from avoiding death.

- Base points per obstacle cleared.
- **Timing bonus**: clearing an obstacle close to the exact beat ("Perfect / Good / OK")
  — this is the addictive rhythm-game hook.
- **Combo multiplier**: consecutive cleared obstacles raise the multiplier
  (e.g. ×2 at 10 combo, ×3 at 25, ×4 at 50 — tune later). Star bursts / "Perfect!"
  popups / milestone notifications celebrate streaks (sound-effect hook points ready
  for future SFX).
- **Fail = hit an obstacle**: the game does **not** stop. The character blinks for a few
  seconds (invincible, passes through obstacles), the multiplier resets to ×1 and the
  combo is lost. The blink window prevents unfair chain-hits on dense sections.
- Final score → per-track leaderboard (Ranked) or local record (Local).

### Difficulty: hybrid — song-driven, player-filtered
The song itself sets natural intensity (busy tracks yield more musical events). On top
of that, a difficulty setting (Easy / Normal / Hard) controls:
- what fraction of detected events become obstacles (density filter,
  min-gap = reaction-time floor per difficulty), and
- how forgiving the Perfect/Good timing windows are.

**Ranked and PvP lock to one canonical difficulty per track** so scores are comparable;
Local mode allows free choice.

### Game modes
| Mode | Description | Phase |
|---|---|---|
| **Local** | Practice / casual. Any song, any difficulty. Scores saved on-device only. | 1–2 |
| **Ranked** | Canonical difficulty, score submits to the global per-track leaderboard. Requires account. | 4 |
| **Player vs Player** | Real-time race on the same track/beatmap; opponents rendered as ghosts, live score comparison. | 5 |

### Controls per platform
| Action | PC (keyboard) | Mobile/tablet (touch) |
|---|---|---|
| Jump / double jump | Space / ↑ | Tap (tap again mid-air) |
| Duck | ↓ (hold) | Swipe down / hold lower half |
| Kick | X / F | Swipe right or dedicated button |
| Lane up/down | ↑ / ↓ | Swipe up / down |

Touch layout must keep thumbs off the play area center; buttons in bottom corners.

## 4. Menus & Game Flow

```
Main Menu ──▶ Mode Select ──▶ Song Select ──▶ Prepare ──▶ Countdown ──▶ Play ──▶ Results
```

1. **Main Menu** — Start Game, Leaderboards, Settings (audio-latency calibration,
   volume), later: Profile.
2. **Mode Select** — Local / Ranked / Player vs Player (Ranked & PvP greyed out until
   their phases ship).
3. **Song Select** — two tabs:
   - *From YouTube*: paste a URL (prototype phases).
   - *Generate with AI*: describe a vibe → original track (**disabled/"coming soon" in
     phase 1**).
   - Local file picker available as a fallback entry.
   - Recently played tracks list (cached audio + beatmap → instant replay, no re-download).
4. **Prepare screen** — staged progress: downloading/extracting audio → analyzing beats →
   building level. Show detected BPM and a fun fact ("312 obstacles generated") while
   waiting.
5. **Countdown** — level and hero visible in place, big 5-4-3-2-1 synced so the music
   starts exactly at 0. In PvP the countdown is server-coordinated so all players start
   together.
6. **Play** — auto-run begins with the music. No stopping or slowing; pause menu is the
   only interruption (Local only — Ranked/PvP pause forfeits or is disallowed, decide in
   phase 4/5).
7. **Results** — score, max combo, Perfect/Good/OK breakdown, leaderboard placement
   (Ranked) or personal best (Local), then Replay / New Song / Rematch (PvP).

## 5. Architecture

```
┌────────────────────────────────────────────────────────┐
│ Client (Phaser 3 + TS + Vite; Capacitor iOS/Android,   │
│         web/PWA for PC — one codebase)                 │
│                                                        │
│  AudioSource (interface) ──▶ decoded audio buffer      │
│   ├─ YouTubeExtractSource (prototype, ytdx/yt-dlp)     │
│   ├─ AIGeneratedSource (production, Suno/StableAudio)  │
│   └─ LocalFileSource (fallback/testing)                │
│              │                                         │
│  BeatmapGenerator (offline analysis of the buffer)     │
│                                                        │
│  Conductor (master clock = audio time, NOT frame time) │
│        │                                               │
│  LevelBuilder (deterministic: beatmap → obstacle list) │
│        │                                               │
│  GameScene (spawning, physics, input, scoring, HUD)    │
└───────────────┬────────────────────────────────────────┘
                │ WebSocket (phase: multiplayer)
┌───────────────▼───────────────────────────────┐
│ Server (Node.js)                              │
│  - Colyseus (or Socket.IO) rooms: races       │
│  - REST: leaderboards, beatmap cache          │
│  - DB: Postgres or Supabase/Firebase          │
└───────────────────────────────────────────────┘
```

### The Conductor — how sync actually works
The single most important rule: **the audio clock is the source of truth, never
`requestAnimationFrame` / frame delta.** Frames stutter; audio doesn't.

- `songTime = audioContext.currentTime - songStartTime`. Since every source (YouTube
  extraction, AI generation, local file) yields a buffer played through Web Audio, sync
  works identically for all of them.
- Every obstacle has a `hitTime` (the musical event's timestamp).
- Spawn position: `x = heroX + (hitTime - songTime) * scrollSpeed`. Obstacles are
  re-positioned from `songTime` every frame — drift is impossible by construction.
- Configurable global latency offset (audio output latency differs per device; add a
  calibration screen later: "tap on the beat" → measures the user's device+reflex offset).

### Beatmap generation (in-browser, source-agnostic)
1. Decode the audio buffer with `OfflineAudioContext` (fast, non-realtime).
2. Onset detection: spectral flux over FFT frames; band-split (low band → "kick" events,
   mid band → "snare" events, overall RMS → energy curve).
3. Estimate BPM (autocorrelation of onset strength) and snap events to the beat grid.
4. Filter by difficulty (min gap between obstacles = human reaction time, ~350–500 ms
   at easy, less at hard).
5. Output beatmap JSON: `{ bpm, offset, events: [{ t, type, strength }] }`.
6. Cache by file hash so re-analysis is skipped; same JSON is what multiplayer shares.

Libraries to evaluate before writing our own: `aubiojs` (WASM port of aubio),
`essentia.js`, `music-tempo`. Fallback: hand-rolled spectral flux (well-documented, ~200
lines).

### Multiplayer (same-track races)
- Room = track (beatmap hash) + set of players; server distributes the same beatmap →
  identical levels, guaranteed fair.
- Countdown start; each client runs its own simulation (deterministic level, local input).
- Clients stream lightweight state (`songTime`, score, combo, alive/dead, y-position) a
  few times/sec; opponents render as **ghosts** — no physics interaction between players,
  which makes netcode simple and lag-tolerant.
- Server is authoritative for final scores (basic anti-cheat: replay of input timestamps
  validated against beatmap; later concern).
- Tech: **Colyseus** (room management built-in) — evaluate vs plain Socket.IO in phase 4.

### High scores
- Per-track leaderboard keyed by beatmap hash + difficulty.
- Start simple: Supabase (Postgres + auth + REST out of the box) — avoids writing a
  backend before multiplayer forces one.

## 6. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Engine | **Phaser 3** (latest, via npm) | Requested; mature 2D, arcade physics, great mobile support |
| Language | TypeScript | Beatmap/netcode correctness needs types |
| Bundler/dev | Vite | Fast, standard for Phaser 3 projects |
| Audio analysis | Web Audio API + aubiojs/essentia.js | Client-side, free, offline-capable |
| Audio source (proto) | ytdx / yt-dlp extraction from YouTube URL | Real songs for playtesting; dev-only |
| Audio source (prod) | AI music API (Suno / Stable Audio / Mubert — evaluate) | Rights-clean, direct audio files |
| Multiplayer | Colyseus (Node.js) | Purpose-built room/state sync |
| Scores/auth | Supabase | Fastest path to leaderboards |
| Distribution | **Capacitor from day one**: native iOS + Android apps (Phaser in a native WebGL view) + same build as web/PWA for PC | One codebase, real store apps |
| Art | Placeholder rectangles → Midjourney sprite sheets | Per plan; art is swappable |

## 7. Roadmap

### Phase 0 — Project setup
- Vite + TypeScript + Phaser 3 scaffold, ESLint/Prettier, responsive canvas
  (`Phaser.Scale.FIT`), web deploy pipeline (e.g. Netlify/Vercel).
- **Capacitor iOS + Android shells from the start** — run the game on real devices early
  so touch feel, safe-area insets, and WKWebView audio quirks are caught immediately,
  not in a late "porting" phase.

### Phase 1 — Core runner (no music yet)
- Auto-running hero (rectangle), arcade physics.
- Jump / double jump / duck / kick / lane movement; keyboard + touch input.
- Hand-authored test beatmap JSON → obstacles spawn from it via the Conductor
  (using a silent metronome clock). Collision, death, restart, basic HUD.
- ✅ *Milestone: game is playable and feels good with a fake beatmap — on phone and PC.*

### Phase 2 — Music sync (YouTube URL prototype)
- Paste a YouTube URL → extract audio (ytdx-style client-side; fall back to a tiny
  `yt-dlp` server if extraction breaks) → decoded buffer. Local MP3/OGG input as well
  (same pipeline, near-zero cost).
- In-browser beatmap generation (onset detection + BPM), difficulty filter.
- Web Audio playback, Conductor driven by `audioContext.currentTime`.
- Timing-based scoring (Perfect/Good/OK), combos, latency offset setting.
- ✅ *Milestone: paste a song's YouTube link, play a level that visibly matches the beat.*

### Phase 3 — Game feel & content
- Midjourney sprites: hero animations (run/jump/duck/kick), obstacle set, parallax
  backgrounds; screen shake, hit flashes, beat-pulsing visuals.
- Calibration screen, pause menu, difficulty select, sound effects hook points.
- ✅ *Milestone: looks and feels like a real game.*

### Phase 4 — Persistence & leaderboards
- Supabase: anonymous → registered accounts, per-track high scores, personal bests.
- ✅ *Milestone: addiction loop closed — beat your friends' scores.*

### Phase 5 — Real-time multiplayer
- Colyseus server, race rooms, ghost rendering, live score race HUD, rematch flow.
- ✅ *Milestone: two phones racing the same song.*

### Phase 6 — AI-generated music (production audio source)
- Evaluate and integrate an AI music API (Suno / Stable Audio / Mubert / Loudly).
- Prompt UX: user describes a vibe or names a style reference → original track generated
  (steered away from exact-song covers for copyright reasons).
- Generated tracks cached server-side (audio + beatmap) so they become the shared,
  rights-clean track library for leaderboards and multiplayer.
- Replaces YouTube extraction as the default source; extraction becomes dev-only.

### Phase 7 — Store release
- Harden the Capacitor builds (icons, splash, IAP/ads decisions, performance passes)
  and submit to the App Store and Google Play; web/PWA stays live for PC.
- YouTube extraction stripped from store builds (rejection risk).

## 8. Key Risks

| Risk | Mitigation |
|---|---|
| YouTube extractors break often (YouTube changes internals) | Treat as prototype-only; keep local-file input as instant fallback; `yt-dlp` server as second fallback |
| App stores reject YouTube-ripping apps | Extraction is gated out of store builds; AI-generated music is the production source (Phase 6) |
| AI "covers" of specific songs still infringe composition rights | Prompt UX steers to style-based generation ("80s hard rock anthem"), not exact-song recreation |
| Beat detection quality varies by genre | Beat-grid snapping, difficulty filtering, allow manual beatmap tweaks later; evaluate 3 libraries early |
| Audio/visual latency on mobile (WKWebView especially) | Audio-clock-driven positioning + per-device calibration screen; test on devices from Phase 0 via Capacitor |
| AI music API cost/quality/latency unknown | Phase 6 starts with a bake-off across providers; generated tracks cached so each is paid for once |
| Multiplayer cheating | Deterministic levels + server-side input-replay validation (later) |

## 9. Project Structure (planned)

```
running_game/
├── src/
│   ├── main.ts               # Phaser game config
│   ├── scenes/               # Boot, Menu, TrackSelect, Game, Results
│   ├── audio/                # AudioSource interface + implementations, Conductor
│   ├── beatmap/              # analysis, generation, types, difficulty filter
│   ├── gameplay/             # hero, obstacles, LevelBuilder, scoring
│   ├── input/                # keyboard + touch abstraction
│   └── net/                  # (phase 5) client netcode
├── server/                   # (phase 5) Colyseus server
├── public/assets/            # sprites, test tracks
└── README.md
```
