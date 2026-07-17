# Asset Quality & Rendering Pipeline Plan

Goal: crisp, "vector-like" hero/obstacle art at any screen resolution, driven by the
original high-res Scenario assets instead of frames pulled from low-res preview MP4s.

## Findings

### Scenario (app.scenario.com — Asset Hub)

| Fact | Detail |
|---|---|
| Original stills | Seedream 4.5 generations, up to **5376×3024 px** ("High (4K)"), **real transparent backgrounds** |
| Still downloads | Per-asset download menu offers **PNG / JPEG / WebP** — PNG keeps alpha |
| Videos | Grok Imagine / Luma Reframe / Seedance 2.0, only **848×480 or 1280×720**, MP4 (no alpha channel) |
| Video upscale | "Enhance" → **Flash VSR Upscale Video**: scaling factor up to **4×** (720p → 5120×2880), Color Fix, Quality slider. Costs credits: 22 (2×) / 44 (4×) per clip |

Implication: the MP4s in `~/Downloads` were never the real source quality. Every
*static* pose should come from the 4K+ transparent PNG stills. Only *animated*
sequences (fly flap, fire kick) must come from video frames.

### Phaser 3 (v3.90 in this project)

1. **Phaser 3 ignores `devicePixelRatio`** ([issue #3198](https://github.com/phaserjs/phaser/issues/3198)).
   Our canvas backing store is 960×540 and `Scale.FIT` only stretches it with CSS —
   on a 2× Retina screen that's a ~3.5× blurry upscale of every frame. Community
   solution ([supernapie](https://supernapie.com/blog/support-retina-with-phaser-3/),
   [discourse](https://phaser.discourse.group/t/settings-for-crisp-rendering/10000)):
   multiply canvas size by DPR, scale the view back down, and zoom the camera so
   game coordinates stay unchanged.
2. **Text objects** rasterize at logical size — after the camera-zoom fix they need
   `setResolution(DPR)` to stay crisp.
3. **Texture atlases** beat individual images (single bind, less memory, named
   frames for anims) — [docs](https://docs.phaser.io/phaser/concepts/textures),
   [TexturePacker guide](https://www.codeandweb.com/texturepacker/tutorials/how-to-create-sprite-sheets-for-phaser).
   Extrude/pad frames to avoid edge bleed.
4. **Mipmaps** (`render.mipmapFilter: 'LINEAR_MIPMAP_LINEAR'`) remove downscale
   shimmer, but Phaser 3 is WebGL1 → **power-of-two textures only**. Pad the atlas
   to POT to qualify.
5. **Don't ship 4K sprite textures**: many mobile GPUs cap `MAX_TEXTURE_SIZE` at
   4096 — a 5376px PNG can fail to upload at all, and a heavily minified giant
   texture looks *worse* without mipmaps. Right-size offline instead: texture ≈
   max on-screen device pixels (logical size × max DPR), maybe ×1.25 headroom.
6. **True vector**: `this.load.svg(key, url, { width, height } | { scale })`
   rasterizes an SVG at load time at any size ([example](https://phaser.io/examples/v3.85.0/loader/svg/view/load-svg-with-fixed-size)) —
   the only genuinely resolution-independent path, needs vector-authored art.

### Current defect stack (why it looks "choppy and not clear")

1. 960×540 canvas CSS-stretched to Retina screen (dominant blur, hits everything).
2. ~480px-tall textures minified 4–5× at render with plain linear filtering, no
   mipmaps → edge shimmer/crawl while animating.
3. Sources were 480p/720p video frames: codec ringing + white-background keying
   fringe baked into the PNGs.

## Sizing math (drives everything)

- Hero renders at ≤ ~122 logical px tall (`HERO_HEIGHT × SPRITE_SCALE`).
- Max DPR worth supporting: 3 (iPhone). → max ~366 device px on screen.
- Target texture height for hero poses: **~450–500 px** (headroom incl.).
- So after the DPR fix, even 720p video frames are adequate for animation;
  the 4K stills get downscaled offline with Lanczos (one clean resample instead
  of GPU undersampling every frame).

## Phases — pilot first, then roll out

### Phase 1 — DPR-aware rendering (engine only, zero asset changes) ✅ DONE

- [x] `constants.ts`: `export const DPR = Math.min(window.devicePixelRatio || 1, 3)`
- [x] `main.ts`: `width/height × DPR`, keep `Scale.FIT`
- [x] Every scene `create()`: `this.cameras.main.setOrigin(0, 0).setZoom(DPR)`.
      **Implementation note:** zooming from the top-left corner (origin 0,0)
      instead of the default center meant NO scroll rebasing was needed —
      `scrollY === 0` still means ground floor, floor pans/falls unchanged,
      and scrollFactor-0 HUD positions render exactly as before.
- [x] Text objects: `resolution: DPR` added to every text style (all scenes +
      InputController pads). New `add.text` calls must include it too.
- [x] `InputController.inZone`: pointer coords arrive in canvas pixels →
      divided by DPR before comparing to logical zone positions.
- [x] Verified in Chrome at DPR 2: canvas backing 1920×1080; menu/song-select/
      game/results all crisp and correctly laid out; hero sprite visibly
      sharper; floor pan + theme repaint correct (HUD stays locked); pause
      button hit-test works even while camera is scrolled; overlay centered;
      no console errors; `tsc`, `eslint`, and `vite build` pass.
- Perf cost = 4× pixels on 2× screens (routine for WebGL; lower the DPR cap
  in constants.ts if an old Android device struggles).

### Phase 2 — Pilot asset: motorcycle-body from the 4K still

- [ ] Download the original Seedream still as PNG from Scenario (5376×3024, alpha)
- [ ] Local prep (script it from day one — `scripts/prepare-asset.sh`):
      `magick in.png -trim +repage -filter Lanczos -resize x500 out.png` + `oxipng`
- [ ] Replace `motorcycle-body.png`; convert `MOTORCYCLE_*` pixel-coordinate
      constants in `Hero.ts` (wheel centers, exhaust, wind anchor) to
      **relative (0–1) coordinates** so they survive any future source size
- [ ] Verify in-game vs. old asset (wheel spinners must still sit on the axles)

### Phase 3 — Animations: fly flap loop + fire kick ✅ DONE (atlas deferred)

What shipped (July 16, 2026):

- **Fly**: rebuilt from the 1280×720 Luma Reframe clip (`asset_FNT3…`, wings
  fit in frame) instead of the 848×480 clip. One full flap cycle — frames
  73–95 of the clip, every 2nd frame = 12 frames — found by SSIM scan for the
  cleanest loop seam; plays as a forward loop (1000ms/cycle), replacing the
  old 4-frame yoyo which read as mechanical.
- **Fire**: 8 consecutive frames (f060–f067) from the sustained-blast section,
  playing across KICK_DURATION ≈ native 24fps flicker (was 3 frames ≈ 8.5fps,
  and fire-3.png shipped with the checkerboard background baked in).
- **Background removal**: `rembg` (via `uvx --python 3.11 --from "rembg[cli]"
  --with onnxruntime`), model per animation: **isnet-general-use for fire**
  (isnet-anime kept the video's white exhaust-smoke blob glued between rider
  and handlebar) and **isnet-anime for fly** (general/birefnet models eat the
  white feathers). The flame is segmented away by every model, so it's
  recovered by **difference-matting against a clean plate frame** (f119 —
  guitar lowered, flame region pure checker) with alpha-unmixing to keep the
  glow. fly-03 had a background wedge leaked between the raised wings —
  punched by intersecting the anime mask with birefnet-general's mask,
  restricted to large flat near-white components (so real feathers survive).
  Pipeline script preserved in the session scratchpad; re-create from this
  description if needed again.
- **Bike stability**: all 8 fire frames share one bike-aligned canvas — wheel
  centers measured in the clip (rear 215,396 / front 656,378) and affine-mapped
  onto motorcycle-body.png's wheel constants (105,535 / 800,535), canvas
  centered on the bike — so the bike no longer jumps when the kick texture
  swaps in/out. Zero code change needed for alignment; frame lists load via
  `import.meta.glob` in Hero.ts (zero-padded filenames = playback order).
- **Sizing**: all frames Lanczos-resized to 500px tall, PNG8-quantized —
  20 frames ≈ 2.0MB total (old 7 frames were 3.1MB).
- Old frames preserved in scratchpad `old-assets-backup/` (and in git history).

Deferred to Phase 4: POT atlas packing + `mipmapFilter` (do it once all
assets are final, one packing pass).

### Phase 4 — Roll out to all assets

- [ ] Static poses from 4K stills: duck, jump, mummy (+ any future obstacles)
- [ ] Fire-kick frames (video pipeline, same as Phase 3)
- [ ] Everything into the shared atlas; delete loose PNGs
- [ ] Commit the prep script + document the pipeline in README

### Phase 5 (optional experiment) — true vector

Flat cel-shaded style traces well: try `vtracer` on one still → SVG →
`this.load.svg(key, url, { scale: DPR })`. If fidelity holds, sprites become
infinitely scalable and tiny on disk. Nice-to-have, not required — Phases 1–4
already deliver "vector-like at any resolution" at game display sizes.

## Decision points (user)

- Spend Scenario credits on Flash VSR upscales? (Only if 720p frames disappoint.)
- Cap DPR at 2 vs 3 for mobile perf.
- Pursue Phase 5 vector experiment.
