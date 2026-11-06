#!/usr/bin/env python3
"""Embed local artwork into the SDK-only desktop entry point."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
source = (root / 'src/plugin.mjs').read_text()
art = json.loads((root / 'assets/scene.json').read_text())
assert source.count('__BONSAI_ART__') == 1
assert len(art['trees']) == 12
out = root / 'desktop/plugin.js'
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(source.replace('__BONSAI_ART__', json.dumps(art, ensure_ascii=False, separators=(',', ':'))))
print(f'Built {out} ({out.stat().st_size} bytes)')
