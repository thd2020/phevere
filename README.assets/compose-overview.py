"""Combine the three phone screenshots into README.assets/phone-overview.png.

The screenshots are 390 x 844 CSS-pixel captures at 2x of the mobile web UI
(`npm run mobile:dev` for the lookup; the Android build with a stubbed native
bridge for Scan and Settings). Run from the repository root:

    python README.assets/compose-overview.py
"""
from PIL import Image, ImageDraw

NAMES = ['phone-lookup.png', 'phone-scan.png', 'phone-settings.png']
PAD, GAP, RADIUS = 48, 56, 64
BACKGROUND, SHADOW = (236, 231, 223), (200, 192, 180)

shots = [Image.open(f'README.assets/{n}').convert('RGB') for n in NAMES]
w, h = shots[0].size
canvas = Image.new('RGB', (PAD * 2 + w * 3 + GAP * 2, PAD * 2 + h), BACKGROUND)
for i, shot in enumerate(shots):
    x = PAD + i * (w + GAP)
    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), radius=RADIUS, fill=255)
    shadow = Image.new('L', (w, h), 0)
    ImageDraw.Draw(shadow).rounded_rectangle((0, 0, w - 1, h - 1), radius=RADIUS, fill=60)
    canvas.paste(SHADOW, (x + 6, PAD + 10), shadow)
    canvas.paste(shot, (x, PAD), mask)
canvas = canvas.resize((canvas.width // 2, canvas.height // 2), Image.LANCZOS)
canvas.save('README.assets/phone-overview.png', optimize=True)
