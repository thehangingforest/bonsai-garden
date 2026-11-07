#!/usr/bin/env python3
"""Package the v3 decor (BONSAI GARDEN 3.xcf) into the plugin assets.

Same contract as prepare_art.py: read Axel's saved XCF export, never redraw it.
Every number below is *derived* from the exported layers, then asserted against
xcf3-delivery.json (the geometry measured in the XCF itself) so a silent drift
fails the build instead of shipping a misaligned garden. Trees are reused
pixel-for-pixel: only the background, the HUD/season anchors and Bunjingi's
stand move in v3. The v3 room drops the black shelf (ETAGERE hidden in the XCF),
repaints the monk and nudges the cat.

No scipy on this box: connected components use a hand-rolled BFS on numpy masks.
"""
import base64
import hashlib
import io
import json
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path('/home/papa/Bureau/SESSIONS/2026-11-06/bonsai-v3')
V1_ASSETS = Path('/home/papa/Bureau/SESSIONS/2026-11-06/assets-v1-frozen')
OUT = ROOT / 'assets'

W, H = 1340, 650
CELL_W, CELL_H = 68, 89
CELLS = [(0, 0, 'chokkan'), (1, 0, 'moyogi'), (2, 0, 'shakan'), (3, 0, 'han-kengai'),
         (0, 1, 'kengai'), (1, 1, 'hokidachi'), (2, 1, 'fukinagashi'),
         (0, 2, 'ishizuki'), (1, 2, 'sokan'), (2, 2, 'kabudachi'), (3, 2, 'yose-ue')]
# Layers drawn by the plugin as live sprites, never baked into the background.
SPRITES = {'Copie de sprites', 'CHAT', 'slot-moine', 'Automn : lorem ipsum...'}
# v1 geometry, kept only to name Bunjingi's shelf slot in the edit list.
PANEL_MIN = 100  # a HUD panel is far bigger than any label fragment


def label(mask):
    """4-connected components of a boolean mask -> [(x0, y0, x1, y1, area)]."""
    seen = np.zeros_like(mask, dtype=bool)
    ys, xs = np.where(mask)
    boxes = []
    for y0, x0 in zip(ys.tolist(), xs.tolist()):
        if seen[y0, x0]:
            continue
        queue = deque([(y0, x0)])
        seen[y0, x0] = True
        xmin = xmax = x0
        ymin = ymax = y0
        area = 0
        while queue:
            y, x = queue.popleft()
            area += 1
            xmin, xmax = min(xmin, x), max(xmax, x)
            ymin, ymax = min(ymin, y), max(ymax, y)
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < mask.shape[0] and 0 <= nx < mask.shape[1] \
                        and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    queue.append((ny, nx))
        boxes.append((xmin, ymin, xmax, ymax, area))
    return boxes


def rect(box):
    return {'x': int(box[0]), 'y': int(box[1]),
            'width': int(box[2] - box[0] + 1), 'height': int(box[3] - box[1] + 1)}


def data_uri(image):
    stream = io.BytesIO()
    image.save(stream, format='PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(stream.getvalue()).decode('ascii')


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    layers = json.loads((SOURCE / 'layers.json').read_text())
    by_name = {item['name']: item for item in layers}
    target = json.loads((SOURCE / 'xcf3-delivery.json').read_text())

    def load(name):
        return Image.open(SOURCE / 'layers' / by_name[name]['file']).convert('RGBA')

    # --- background: visible layers, minus the sprite layers -----------------
    background = Image.new('RGBA', (W, H))
    for item in reversed(layers):  # bottom-up
        if not item['visible'] or item['name'] in SPRITES:
            continue
        background.alpha_composite(load(item['name']), (item['x'], item['y']))

    # --- HUD panels: Axel's own black rectangles, measured in the TOOLS layer
    tools = np.asarray(load('TOOLS')).astype(int)
    black = (tools[:, :, 3] > 0) & (tools[:, :, :3] == 0).all(axis=2)
    panels = sorted((rect(b) for b in label(black)
                     if b[2] - b[0] + 1 >= PANEL_MIN and b[3] - b[1] + 1 >= PANEL_MIN),
                    key=lambda r: (r['x'], r['y']))
    assert len(panels) == 4, panels
    ox, oy = by_name['TOOLS']['x'], by_name['TOOLS']['y']
    draw = ImageDraw.Draw(background)
    hud = {}
    for key, r in zip(('time', 'date', 'crons', 'cost'), panels):
        # TOOLS sits on a wider canvas (negative offset): paint on the *canvas*, not the layer.
        box = (r['x'] + ox, r['y'] + oy, r['x'] + ox + r['width'] - 1, r['y'] + oy + r['height'] - 1)
        draw.rectangle(box, fill=(0, 0, 0, 255))
        hud[key] = {'x': box[0], 'y': box[1], 'width': r['width'], 'height': r['height']}
    assert [hud[k]['x'] for k in ('time', 'date', 'crons', 'cost')] == [136, 407, 1074, 1082], hud
    assert all(hud[k]['width'] == 123 and hud[k]['height'] == 166 for k in hud), hud
    # The season readout replaces Axel's placeholder caption: same anchor, and the
    # text must land on plain fond (cream on dark red), never over the room art.
    cap, cap_img = by_name['Automn : lorem ipsum...'], load('Automn : lorem ipsum...')
    hud['season'] = {'x': cap['x'], 'y': cap['y'], 'width': cap_img.width, 'height': cap_img.height}
    after = np.asarray(background)
    for key in ('time', 'date', 'crons', 'cost'):
        h = hud[key]
        chip = after[h['y']:h['y'] + h['height'], h['x']:h['x'] + h['width']]
        assert (chip == np.array([0, 0, 0, 255])).all(), f'{key}: HUD panel not painted black'
    season_zone = after[cap['y']:cap['y'] + cap_img.height, cap['x']:cap['x'] + cap_img.width]
    assert (season_zone[:, :, :3] == np.array([102, 0, 0])).all(), 'season band not on plain fond'
    background.save(OUT / 'background.png', optimize=True)
    scene = {'width': W, 'height': H, 'background': data_uri(background), 'trees': []}

    # --- trees: same sheet cells as v1, byte-identical sprites ---------------
    sheet = load('Copie de sprites')
    sheet_meta = by_name['Copie de sprites']
    for col, row, name in CELLS:
        x0, y0 = col * CELL_W, row * CELL_H
        tile = sheet.crop((x0, y0, x0 + CELL_W, y0 + CELL_H))
        box = tile.getchannel('A').getbbox()
        assert box, name
        sprite = tile.crop(box)
        sprite.save(OUT / f'{name}.png', optimize=True)
        shipped = np.asarray(Image.open(V1_ASSETS / f'{name}.png').convert('RGBA'))
        assert np.asarray(sprite).shape == shipped.shape and (np.asarray(sprite) == shipped).all(), \
            f'{name}: v3 tree pixels differ from the shipped v1 tree'
        scene['trees'].append({'id': name, 'x': sheet_meta['x'] + x0 + box[0],
                               'y': sheet_meta['y'] + y0 + box[1],
                               'width': sprite.width, 'height': sprite.height,
                               'src': data_uri(sprite)})
    # Bunjingi's copy sits alone at the right edge of the sheet, on stand #4 in v2.
    loose = np.asarray(sheet).astype(int)
    loose[:, :700] = 0  # sheet-local: only Bunjingi's copy lives past x=700
    loose_box = np.argwhere(loose[:, :, 3] > 0)
    y0, x0 = (int(v) for v in loose_box.min(axis=0))
    y1, x1 = (int(v) for v in loose_box.max(axis=0))
    bunjingi = sheet.crop((x0, y0, x1 + 1, y1 + 1))
    bunjingi.save(OUT / 'bunjingi.png', optimize=True)
    scene['trees'].insert(7, {'id': 'bunjingi', 'x': sheet_meta['x'] + x0,
                              'y': sheet_meta['y'] + y0, 'width': bunjingi.width,
                              'height': bunjingi.height, 'src': data_uri(bunjingi)})

    # --- monk and cat: layer alpha boxes -------------------------------------
    for key, name in [('monk', 'slot-moine'), ('cat', 'CHAT')]:
        image = load(name)
        box = image.getchannel('A').getbbox()
        assert box
        cropped = image.crop(box)
        cropped.save(OUT / f'{key}.png', optimize=True)
        meta = by_name[name]
        scene[key] = {'x': meta['x'] + box[0], 'y': meta['y'] + box[1],
                      'width': cropped.width, 'height': cropped.height, 'src': data_uri(cropped)}

    # --- stands: the four pedestals Axel drew --------------------------------
    ped = np.asarray(load('piedestaux')).astype(int)[:, :, 3] > 0
    ped_meta = by_name['piedestaux']
    # left-to-right, the order the plugin walks when it fills the shelves
    stands = sorted((rect(b) for b in label(ped)), key=lambda r: (r['x'], r['y']))
    assert len(stands) == 4, stands
    for r in stands:
        r['x'] += ped_meta['x']
        r['y'] += ped_meta['y']
    scene['stands'] = stands
    scene['hud'] = hud

    # --- the whole scene must match the measured delivery --------------------
    mine = {t['id']: {k: t[k] for k in ('x', 'y', 'width', 'height')} for t in scene['trees']}
    theirs = {t['id']: {k: t[k] for k in ('x', 'y', 'width', 'height')} for t in target['trees']}
    theirs['bunjingi'] = {k: target['bunjingi'][k] for k in ('x', 'y', 'width', 'height')}
    assert set(mine) == set(theirs) and len(mine) == 12, (sorted(mine), sorted(theirs))
    for tid, box in theirs.items():
        assert mine[tid] == box, f'{tid}: derived {mine[tid]} != delivered {box}'
    for key in ('monk', 'cat'):
        assert {k: scene[key][k] for k in ('x', 'y', 'width', 'height')} == target[key], key
    assert stands == target['stands'], (stands, target['stands'])

    xcf = SOURCE / 'BONSAI-GARDEN-3-source.xcf'
    scene['provenance'] = {'source': xcf.name,
                           'sha256': hashlib.sha256(xcf.read_bytes()).hexdigest(),
                           'edits': ['Live HUD panels moved with Axel\'s TOOLS layer',
                                     'Season readout replaces the placeholder caption on plain fond',
                                     'Bunjingi sits on stand #4 when idle',
                                     'v3 room: black shelf hidden, monk repainted, cat nudged',
                                     'Trees, stones and sand unchanged from v1 at the pixel']}
    assert len(scene['trees']) == 12
    assert len({tree['id'] for tree in scene['trees']}) == 12
    (OUT / 'scene.json').write_text(json.dumps(scene, ensure_ascii=False, separators=(',', ':')) + '\n')

    preview = background.copy()
    for item in scene['trees'] + [scene['cat']]:
        image = Image.open(io.BytesIO(base64.b64decode(item['src'].split(',', 1)[1]))).convert('RGBA')
        preview.alpha_composite(image, (item['x'], item['y']))
    preview.save(SOURCE / 'idle-art-preview-v3.png')
    print(f"Decor v3: {len(scene['trees'])} trees (v1 pixels), monk, cat, "
          f"{len(stands)} stands; native {W}x{H}")
    print(f"HUD: " + ', '.join(f"{k}=({v['x']},{v['y']},{v['width']},{v['height']})"
                               for k, v in scene['hud'].items()))
    print(f"Delivered geometry matched for {len(theirs)} sprites, monk, cat, {len(stands)} stands")
    print(f"Manifest: {OUT / 'scene.json'}")
    print(f"Preview:  {SOURCE / 'idle-art-preview-v3.png'}")


if __name__ == '__main__':
    main()
