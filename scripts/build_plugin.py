#!/usr/bin/env python3
"""Embed local artwork, monthly care tips and agent avatars into the SDK-only desktop entry point."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
source = (root / 'src/plugin.mjs').read_text()
art = json.loads((root / 'assets/scene.json').read_text())
tips = json.loads((root / 'assets/care-tips.json').read_text())
avatars = json.loads((root / 'assets/avatars.json').read_text())

assert source.count('__BONSAI_ART__') == 1
assert len(art['trees']) == 12, 'the artwork must deliver twelve bonsai sprites'
assert len(art['stands']) >= 1, 'busy agents need at least one drawn pedestal'

# Monthly care tips: one short plain sentence per month, keyed 01..12.
assert sorted(tips) == [f'{month:02d}' for month in range(1, 13)], 'twelve monthly tips, keyed 01..12'
for key, tip in tips.items():
    assert isinstance(tip, str) and tip.strip() == tip, f'tip {key} must be a trimmed string'
    assert 40 <= len(tip) <= 60, f'tip {key} must stay within 40-60 characters, got {len(tip)}'
    assert not (set(';"\u00ab\u00bb') & set(tip)), f'tip {key} must avoid quotes and semicolons'
    assert all(ord(character) < 0x2000 for character in tip), f'tip {key} stays plain text, no emoji'

# Avatars: one small pixel portrait per agent profile, inlined as a data URI.
assert avatars, 'avatars.json must not be empty'
for profile, data in avatars.items():
    assert isinstance(profile, str) and profile, 'avatar keys are profile names'
    assert isinstance(data, str) and data.startswith('data:image/'), f'avatar {profile} must be an inline image'

art['tips'] = tips
art['avatars'] = avatars
out = root / 'desktop/plugin.js'
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(source.replace('__BONSAI_ART__', json.dumps(art, ensure_ascii=False, separators=(',', ':'))))
print(f'Built {out} ({out.stat().st_size} bytes, {len(tips)} tips, {len(avatars)} avatars)')
