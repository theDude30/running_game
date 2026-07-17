# Packs every hero/obstacle sprite frame into one power-of-two texture atlas
# (Phaser 3 JSON-hash format). POT dimensions matter: the game enables
# render.mipmapFilter (see main.ts), and WebGL1 only generates mipmaps for
# power-of-two textures.
#
# The loose per-frame PNGs in src/assets/hero and src/assets/obstacles stay in
# the repo as the source of truth (they are not imported by game code, so Vite
# doesn't bundle them); rerun this after changing any of them:
#
#   uv run --with pillow --with numpy python3 scripts/pack-atlas.py
#
# Frames are alpha-trimmed (Phaser restores the untrimmed geometry from
# spriteSourceSize/sourceSize) and edge-extruded by 2px so mipmap/linear
# sampling doesn't bleed transparent gutter pixels into frame edges.

import json
import os
from PIL import Image
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERO = os.path.join(ROOT, 'src/assets/hero')
OBST = os.path.join(ROOT, 'src/assets/obstacles')
OUT_DIR = os.path.join(ROOT, 'src/assets/atlas')
ATLAS_W = 4096
PAD = 4      # transparent gutter between frames (beyond the extrusion)
EXTRUDE = 2  # duplicated edge pixels around each frame

sources = sorted(
    [os.path.join(HERO, f) for f in os.listdir(HERO) if f.endswith('.png')]
    + [os.path.join(OBST, 'mummy.png')]
)

entries = []
for path in sources:
    name = os.path.splitext(os.path.basename(path))[0]
    im = Image.open(path).convert('RGBA')
    a = np.asarray(im)[..., 3]
    ys, xs = np.where(a > 0)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    entries.append({
        'name': name,
        'img': im.crop((x0, y0, x1, y1)),
        'trim': (int(x0), int(y0)),
        'source': im.size,
    })

# shelf packing, tallest first for tight rows
entries.sort(key=lambda e: -e['img'].height)
cell = PAD + EXTRUDE  # spacing applied on each side of a frame
x = y = row_h = 0
for e in entries:
    w, h = e['img'].size
    if x + w + 2 * cell > ATLAS_W:
        x = 0
        y += row_h
        row_h = 0
    e['pos'] = (x + cell, y + cell)
    x += w + 2 * cell
    row_h = max(row_h, h + 2 * cell)
used_h = y + row_h

atlas_h = 1
while atlas_h < used_h:
    atlas_h *= 2
assert atlas_h <= 4096, f'atlas would be {used_h}px tall — exceeds the 4096 POT budget'

atlas = Image.new('RGBA', (ATLAS_W, atlas_h), (0, 0, 0, 0))
frames = {}
for e in entries:
    img, (fx, fy) = e['img'], e['pos']
    w, h = img.size
    atlas.paste(img, (fx, fy))
    # edge extrusion: repeat the outermost rows/columns into the gutter
    for i in range(1, EXTRUDE + 1):
        atlas.paste(img.crop((0, 0, w, 1)), (fx, fy - i))
        atlas.paste(img.crop((0, h - 1, w, h)), (fx, fy + h + i - 1))
        atlas.paste(img.crop((0, 0, 1, h)), (fx - i, fy))
        atlas.paste(img.crop((w - 1, 0, w, h)), (fx + w + i - 1, fy))
    sw, sh = e['source']
    frames[e['name']] = {
        'frame': {'x': fx, 'y': fy, 'w': w, 'h': h},
        'rotated': False,
        'trimmed': (w, h) != (sw, sh),
        'spriteSourceSize': {'x': e['trim'][0], 'y': e['trim'][1], 'w': w, 'h': h},
        'sourceSize': {'w': sw, 'h': sh},
    }

os.makedirs(OUT_DIR, exist_ok=True)
# One shared 256-color palette across all frames (they share the same art
# style, so this is visually lossless at game scale) — ~6x smaller than RGBA.
# No dithering: it adds speckle noise that wrecks PNG compression on flat art.
atlas = atlas.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
atlas.save(os.path.join(OUT_DIR, 'hero.png'), optimize=True)
with open(os.path.join(OUT_DIR, 'hero.json'), 'w') as f:
    json.dump({
        'frames': frames,
        'meta': {'image': 'hero.png', 'size': {'w': ATLAS_W, 'h': atlas_h}, 'scale': '1'},
    }, f, indent=1)

kb = os.path.getsize(os.path.join(OUT_DIR, 'hero.png')) // 1024
print(f'{ATLAS_W}x{atlas_h} atlas, {len(frames)} frames, used height {used_h}px, {kb}KB')
