#!/usr/bin/env python3
"""Package Axel's saved XCF exports; never redraw or overwrite the XCF."""
import base64
import hashlib
import io
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path('/home/papa/Bureau/SESSIONS/2026-11-06/bonsai-integration')
OUT = ROOT / 'assets'


def data_uri(image):
    stream = io.BytesIO()
    image.save(stream, format='PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(stream.getvalue()).decode('ascii')


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    layers = json.loads((SOURCE / 'layers.json').read_text())
    by_name = {item['name']: item for item in layers}

    def load(name):
        return Image.open(SOURCE / 'layers' / by_name[name]['file']).convert('RGBA')

    background = Image.new('RGBA', (1340, 650))
    excluded = {'chat', 'Copie de sprites', 'slot-moine', 'Automn : lorem ipsum...', 'guides'}
    for item in reversed(layers):
        if not item['visible'] or item['name'] in excluded:
            continue
        image = load(item['name'])
        if item['name'] == 'shelve':
            draw = ImageDraw.Draw(image)
            # Blank only old HUD captions, retaining Axel's black rectangle geometry.
            for x, y, w, h in [(81, 61, 123, 166), (352, 58, 123, 166),
                               (1019, 58, 123, 166), (1027, 449, 123, 166)]:
                lx, ly = x - item['x'], y - item['y']
                draw.rectangle((lx, ly, lx + w - 1, ly + h - 1), fill=(0, 0, 0, 255))
            # This square and the word 'avatar' were placeholders, not a pedestal.
            draw.rectangle((800 - item['x'], 515 - item['y'],
                            1000 - item['x'], 586 - item['y']), fill=(0, 0, 0, 0))
        background.alpha_composite(image, (item['x'], item['y']))
    background.save(OUT / 'background.png', optimize=True)
    scene = {'width': 1340, 'height': 650, 'background': data_uri(background), 'trees': []}

    sheet = load('Copie de sprites')
    sheet_meta = by_name['Copie de sprites']
    # Source cell boundaries (64x80) from the sprite sheet; not inferred names.
    # Bunjingi's copy was manually moved onto the stand in the XCF.
    cells = [(0, 0, 'chokkan'), (1, 0, 'moyogi'), (2, 0, 'shakan'), (3, 0, 'han-kengai'),
             (0, 1, 'kengai'), (1, 1, 'hokidachi'), (2, 1, 'fukinagashi'),
             (0, 2, 'ishizuki'), (1, 2, 'sokan'), (2, 2, 'kabudachi'), (3, 2, 'yose-ue')]
    for col, row, name in cells:
        x0, y0 = col * 68, row * 89
        tile = sheet.crop((x0, y0, x0 + 68, y0 + 89))
        box = tile.getchannel('A').getbbox()
        assert box, name
        sprite = tile.crop(box)
        sprite.save(OUT / f'{name}.png', optimize=True)
        scene['trees'].append({'id': name, 'x': sheet_meta['x'] + x0 + box[0],
                               'y': sheet_meta['y'] + y0 + box[1],
                               'width': sprite.width, 'height': sprite.height,
                               'src': data_uri(sprite)})
    bunjingi_region = sheet.crop((660, 170, 715, 264))
    box = bunjingi_region.getchannel('A').getbbox()
    assert box
    sprite = bunjingi_region.crop(box)
    sprite.save(OUT / 'bunjingi.png', optimize=True)
    scene['trees'].insert(7, {'id': 'bunjingi', 'x': 282, 'y': 390,
                              'width': sprite.width, 'height': sprite.height, 'src': data_uri(sprite)})
    for key, name in [('monk', 'slot-moine'), ('cat', 'chat')]:
        image = load(name)
        box = image.getchannel('A').getbbox()
        assert box
        cropped = image.crop(box)
        cropped.save(OUT / f'{key}.png', optimize=True)
        meta = by_name[name]
        scene[key] = {'x': meta['x'] + box[0], 'y': meta['y'] + box[1],
                      'width': cropped.width, 'height': cropped.height, 'src': data_uri(cropped)}
    scene['stands'] = [dict(zip(['x', 'y', 'width', 'height'], values)) for values in
                        [(400, 467, 78, 42), (484, 509, 78, 42),
                         (582, 543, 78, 42), (698, 525, 78, 42)]]
    scene['hud'] = {key: dict(zip(['x', 'y', 'width', 'height'], values)) for key, values in {
        'time': (81, 61, 123, 166), 'date': (352, 58, 123, 166),
        'crons': (1019, 58, 123, 166), 'cost': (1027, 449, 123, 166),
        'season': (491, 71, 480, 40),
    }.items()}
    scene['provenance'] = {'source': '2026-11-05-bureau.xcf',
                           'sha256': hashlib.sha256((SOURCE / '2026-11-06-bureau-source.xcf').read_bytes()).hexdigest(),
                           'edits': ['Replace placeholder labels with live text',
                                     'Return Bunjingi to empty shelf slot when idle',
                                     'Separate trees, monk and edited cat without recoloring']}
    assert len(scene['trees']) == 12
    assert len({tree['id'] for tree in scene['trees']}) == 12
    (OUT / 'scene.json').write_text(json.dumps(scene, ensure_ascii=False, separators=(',', ':')) + '\n')
    preview = background.copy()
    for item in scene['trees'] + [scene['cat']]:
        image = Image.open(io.BytesIO(base64.b64decode(item['src'].split(',', 1)[1]))).convert('RGBA')
        preview.alpha_composite(image, (item['x'], item['y']))
    preview.save(SOURCE / 'idle-art-preview.png')
    print(f"Artwork: {len(scene['trees'])} trees, monk, edited cat; native {scene['width']}x{scene['height']}")
    print(f"Manifest: {OUT / 'scene.json'}")


if __name__ == '__main__':
    main()
