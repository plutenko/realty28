#!/usr/bin/env python3
"""Replace 'ОТДЕЛ ПРОДАЖ' text with 'ОТЧЁТЫ' on the shield logo.

Image analysis reveals:
  - Shield badge on the book: x≈615-690, y≈370-450
  - Shield background: near-black RGB(0-15, 0-15, 0-15)
  - Wolf head icon: y≈367-376 (top of shield)
  - 'ОТДЕЛ ПРОДАЖ' small text: y≈376-386, x≈615-680
  - 'СОБР' large text: y≈388-435
  - Book (tan) surrounds the shield: HSV hue ≈ 19, sat > 60
"""
import os
import shutil

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

SRC = "/Users/plutenko/.cursor/projects/Users-plutenko-Documents-Cursor-AI/assets/Generated_image-25757a4e-ee02-4ae6-b649-9289c473b28f.png"
OUT_WS = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "assets",
    "wolf-book-logo-otchety.png",
)
OUT_CURSOR = "/Users/plutenko/.cursor/projects/Users-plutenko-Documents-Cursor-AI/assets/wolf-book-logo-otchety.png"

# "ОТДЕЛ ПРОДАЖ" text region (determined by pixel analysis)
TEXT_Y_MIN = 375
TEXT_Y_MAX = 387
TEXT_X_MIN = 614
TEXT_X_MAX = 685

# Shield background is near-black
SHIELD_BG = (5, 5, 5)


def main():
    img_pil = Image.open(SRC).convert("RGB")
    arr = np.array(img_pil)
    h, w = arr.shape[:2]

    # Step 1: Erase "ОТДЕЛ ПРОДАЖ" text in the shield
    # Only erase bright pixels (text) within the shield; leave dark bg alone
    result = arr.copy()
    erased_count = 0

    # Sample actual shield background color from nearby dark pixels
    bg_samples = []
    for y in range(TEXT_Y_MIN - 3, TEXT_Y_MAX + 3):
        for x in range(TEXT_X_MIN, TEXT_X_MAX):
            if 0 <= y < h and 0 <= x < w:
                r, g, b = arr[y, x]
                brightness = (int(r) + int(g) + int(b)) / 3
                if brightness < 30:
                    bg_samples.append((int(r), int(g), int(b)))

    if bg_samples:
        bg_arr = np.array(bg_samples)
        bg_color = tuple(int(v) for v in np.median(bg_arr, axis=0))
    else:
        bg_color = SHIELD_BG
    print(f"Shield bg: {bg_color}")

    # Erase text pixels: anything brighter than the shield bg in the text region
    for y in range(TEXT_Y_MIN, TEXT_Y_MAX + 1):
        for x in range(TEXT_X_MIN, TEXT_X_MAX + 1):
            if 0 <= y < h and 0 <= x < w:
                r, g, b = arr[y, x]
                brightness = (int(r) + int(g) + int(b)) / 3
                # Text pixels are > ~80 brightness; shield bg is < 30
                # Also skip tan book pixels (high saturation, hue ~19)
                max_ch = max(r, g, b)
                min_ch = min(r, g, b)
                saturation = int(max_ch) - int(min_ch)

                if brightness > 50 and saturation < 50:
                    # This is a gray/white text pixel (not tan book)
                    # Blend toward shield bg based on brightness
                    alpha = min(1.0, (brightness - 30) / 200.0)
                    result[y, x] = (
                        int(bg_color[0] * alpha + r * (1 - alpha)),
                        int(bg_color[1] * alpha + g * (1 - alpha)),
                        int(bg_color[2] * alpha + b * (1 - alpha)),
                    )
                    erased_count += 1

    print(f"Erased {erased_count} text pixels in y=[{TEXT_Y_MIN},{TEXT_Y_MAX}] x=[{TEXT_X_MIN},{TEXT_X_MAX}]")

    # Slight blur to smooth the erased region
    erase_mask = np.zeros((h, w), dtype=np.float32)
    for y in range(TEXT_Y_MIN, TEXT_Y_MAX + 1):
        for x in range(TEXT_X_MIN, TEXT_X_MAX + 1):
            if 0 <= y < h and 0 <= x < w:
                r_o, g_o, b_o = arr[y, x]
                r_n, g_n, b_n = result[y, x]
                if (r_o, g_o, b_o) != (r_n, g_n, b_n):
                    erase_mask[y, x] = 1.0

    blur_mask = cv2.GaussianBlur(erase_mask, (3, 3), 0.5)
    for c in range(3):
        orig = arr[:, :, c].astype(np.float32)
        new = result[:, :, c].astype(np.float32)
        blended = new * blur_mask + orig * (1.0 - blur_mask)
        result[:, :, c] = np.clip(blended, 0, 255).astype(np.uint8)

    # Step 2: Draw "ОТЧЁТЫ" text centered in the erased region
    img_out = Image.fromarray(result)
    draw = ImageDraw.Draw(img_out)

    new_text = "ОТЧЁТЫ"
    center_x = (TEXT_X_MIN + TEXT_X_MAX) // 2
    center_y = (TEXT_Y_MIN + TEXT_Y_MAX) // 2
    region_w = TEXT_X_MAX - TEXT_X_MIN
    region_h = TEXT_Y_MAX - TEXT_Y_MIN

    font_candidates = [
        "/Library/Fonts/Arial Unicode.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/HelveticaNeue.ttc",
    ]

    best_font = None
    for size in range(region_h + 4, 4, -1):
        for fc in font_candidates:
            if not os.path.exists(fc):
                continue
            try:
                font = ImageFont.truetype(fc, size=size)
                bb = draw.textbbox((0, 0), new_text, font=font)
                tw = bb[2] - bb[0]
                th = bb[3] - bb[1]
                if tw <= region_w and th <= region_h:
                    best_font = font
                    break
            except Exception:
                continue
        if best_font:
            break

    if best_font is None:
        best_font = ImageFont.load_default()

    bb = draw.textbbox((0, 0), new_text, font=best_font)
    tw = bb[2] - bb[0]
    th = bb[3] - bb[1]

    tx = center_x - tw // 2
    ty = center_y - th // 2 - bb[1]

    # White text matching original style
    draw.text((tx, ty), new_text, fill=(220, 220, 220), font=best_font)
    print(f"Drew '{new_text}' at ({tx}, {ty}), size {tw}x{th}, region center ({center_x}, {center_y})")

    os.makedirs(os.path.dirname(OUT_WS), exist_ok=True)
    img_out.save(OUT_WS)
    print(f"Saved: {OUT_WS}")

    try:
        shutil.copy2(OUT_WS, OUT_CURSOR)
        print(f"Copied: {OUT_CURSOR}")
    except OSError as e:
        print(f"Copy note: {e}")


if __name__ == "__main__":
    main()
