#!/usr/bin/env python3
"""Repack the shipped background from Axel's BONSAI GARDEN 31.xcf.

Why: the v1-v3 packers baked four opaque black pavers into assets/background.png, exactly on
the HUD rectangles, because the tool frames used to be painted in the artwork. They are DOM
objects now (opaque movable plaques), so the fond must carry the scenery alone. Axel's 31 XCF
holds exactly that: one visible layer, named 'fond', with the room and nothing else.

Only the bitmap and the provenance line change. Width, height, stands, trees, hud, monk, cat
stay untouched: the export shows pedestals identical at the pixel and sand/stones within
3%, see SESSIONS/2026-11-08/bonsai-31/fond-31-diff.txt.

Usage: python3 scripts/prepare_art31.py
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import shutil
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent.parent
ASSETS = HERE / 'assets'
XCF = Path('/home/papa/Bureau/BONSAI GARDEN 31.xcf')
FOND_LAYER = Path('/home/papa/Bureau/SESSIONS/2026-11-08/bonsai-31/layers/0.png')
TRACES = Path('/home/papa/Bureau/SESSIONS/2026-11-08/repack-31-before')
TOOL_KEYS = ('time', 'date', 'crons', 'cost')


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    scene_path = ASSETS / 'scene.json'
    scene = json.loads(scene_path.read_text('utf-8'))
    flat = Image.open(FOND_LAYER).convert('RGB')
    expected = (scene['width'], scene['height'])
    assert flat.size == expected, f'{FOND_LAYER} is {flat.size}, the scene is {expected}'
    assert FOND_LAYER.stat().st_mtime >= XCF.stat().st_mtime, 'the export is older than the XCF'

    # Traces first: the delivered bitmap and scene are copied out before anything is overwritten.
    TRACES.mkdir(parents=True, exist_ok=True)
    for name in ('background.png', 'scene.json'):
        target = TRACES / name
        if not target.exists():
            shutil.copy2(ASSETS / name, target)
            print(f'trace kept: {target}')

    fresh = flat.convert('RGBA')
    fresh.save(ASSETS / 'background.png', optimize=True)

    # The tool rectangles must show scenery again: no baked paver left inside them.
    for key in TOOL_KEYS:
        rect = scene['hud'][key]
        box = (rect['x'], rect['y'], rect['x'] + rect['width'], rect['y'] + rect['height'])
        pixels = list(fresh.crop(box).convert('RGB').getdata())
        share = 100 * sum(1 for pixel in pixels if max(pixel) < 60) / len(pixels)
        print(f'  {key:7s} strict black inside the frame: {share:5.1f}%')
        assert share <= 25, f'{key} still holds a baked paver ({share:.1f}% black)'

    buffer = io.BytesIO()
    fresh.save(buffer, format='PNG', optimize=True)
    scene['background'] = 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode('ascii')

    provenance = dict(scene.get('provenance') or {})
    provenance['source'] = XCF.name
    provenance['sha256'] = sha256(XCF)
    provenance['edits'] = [edit for edit in provenance.get('edits', []) if 'paver' not in edit]
    provenance['edits'].append(
        'fond repacked from the 31 XCF (single visible layer "fond"): the four painted black '
        'pavers are gone, the tool frames are opaque DOM plaques now'
    )
    scene['provenance'] = provenance

    scene_path.write_text(json.dumps(scene, ensure_ascii=False, separators=(',', ':')) + '\n', 'utf-8')
    print(f'asset written: {ASSETS / "background.png"} ({(ASSETS / "background.png").stat().st_size} bytes)')
    print(f'asset written: {scene_path} ({scene_path.stat().st_size} bytes)')
    print(f'provenance: source={provenance["source"]} sha256={provenance["sha256"][:16]}...')


if __name__ == '__main__':
    main()
