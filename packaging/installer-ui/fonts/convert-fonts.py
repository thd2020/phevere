"""Regenerate native fonts from the existing licensed Fontsource dependency.

Run from the repository root with fonttools and brotli installed. The resulting
TTF files are committed, so installer builds need no Python or conversion step.
"""
from pathlib import Path
from shutil import copyfile
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parents[3]
output = Path(__file__).resolve().parent
source = root / "node_modules" / "@fontsource" / "outfit"
for weight, name in [(400, "regular"), (600, "semibold"), (700, "bold")]:
    font = TTFont(source / "files" / f"outfit-latin-{weight}-normal.woff2")
    font.flavor = None
    font.save(output / f"outfit-{name}.ttf")
copyfile(source / "LICENSE", output / "LICENSE.txt")
