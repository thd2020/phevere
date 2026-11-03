"""Combine the phone screenshots of Words and Learn into README strips.

The screenshots are 390 x 844 CSS-pixel captures of the mobile web UI (`npm run mobile:dev`),
seeded with a demo notebook of 153 neutral words and cropped to 324 x 634 (above the tab bar).
Run from the repository root:

    python README.assets/compose-learning.py
"""
from PIL import Image, ImageDraw

STRIPS = {
    'learning-overview.png': ['learn-quiz.png', 'learn-progress.png', 'words-library.png', 'words-origins.png'],
    'learning-detail.png': ['words-book.png', 'learn-answer.png', 'words-map.png'],
}
PAD, GAP, RADIUS = 28, 28, 26
BACKGROUND, SHADOW = (236, 231, 223), (200, 192, 180)

for out, names in STRIPS.items():
    shots = [Image.open(f'README.assets/{n}').convert('RGB') for n in names]
    w, h = shots[0].size
    canvas = Image.new('RGB', (PAD * 2 + w * len(shots) + GAP * (len(shots) - 1), PAD * 2 + h), BACKGROUND)
    for i, shot in enumerate(shots):
        x = PAD + i * (w + GAP)
        mask = Image.new('L', (w, h), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), radius=RADIUS, fill=255)
        shadow = Image.new('L', (w, h), 0)
        ImageDraw.Draw(shadow).rounded_rectangle((0, 0, w - 1, h - 1), radius=RADIUS, fill=60)
        canvas.paste(SHADOW, (x + 4, PAD + 6), shadow)
        canvas.paste(shot, (x, PAD), mask)
    canvas.save(f'README.assets/{out}', optimize=True)
