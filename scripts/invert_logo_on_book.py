#!/usr/bin/env python3
"""
Invert logo on book: white strokes → black, black shield → transparent (tan shows).
Only pixels inside a tight logo mask (largest contour in book crop) — no wolf/circle edits.
"""
import os
import shutil
from typing import Optional, Tuple

import cv2
import numpy as np

SRC = "/Users/plutenko/.cursor/projects/Users-plutenko-Documents-Cursor-AI/assets/Generated_image-4df0ea19-71b0-4d07-ac51-5eae82095cd2.png"
OUT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "assets",
    "wolf-book-logo-fixed.png",
)
OUT_CURSOR = "/Users/plutenko/.cursor/projects/Users-plutenko-Documents-Cursor-AI/assets/wolf-book-logo-fixed.png"


def build_logo_mask(
    bgr: np.ndarray, gray: np.ndarray
) -> Tuple[Optional[np.ndarray], Tuple[int, int, int, int]]:
    """
    Returns full-size uint8 mask 0/255: where logo pixels may be edited.
    Crop box (x0,y0,w,h) used for detection.
    """
    h, w = bgr.shape[:2]
    x0, x1 = int(0.52 * w), int(0.87 * w)
    y0, y1 = int(0.44 * h), int(0.82 * h)
    sl = gray[y0:y1, x0:x1]
    if sl.size == 0:
        return None, (0, 0, 0, 0)

    # B&W logo parts only (exclude mid-tone tan book)
    m = ((sl < 54) | (sl > 230)).astype(np.uint8) * 255
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))

    cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return None, (x0, y0, x1 - x0, y1 - y0)
    cnt = max(cnts, key=cv2.contourArea)
    area = cv2.contourArea(cnt)
    if area < 3000 or area > 120000:
        return None, (x0, y0, x1 - x0, y1 - y0)

    patch = np.zeros_like(sl, dtype=np.uint8)
    cv2.drawContours(patch, [cnt], -1, 255, -1)
    patch = cv2.dilate(patch, np.ones((9, 9), np.uint8))

    full = np.zeros((h, w), dtype=np.uint8)
    full[y0:y1, x0:x1] = patch

    # Do not bleed onto suit / fur: restrict to dilated tan book area
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    tan = cv2.inRange(hsv, np.array([6, 22, 55]), np.array([42, 210, 255]))
    tan = cv2.morphologyEx(tan, cv2.MORPH_CLOSE, np.ones((11, 11), np.uint8))
    tan = cv2.dilate(tan, np.ones((25, 25), np.uint8))
    full = cv2.bitwise_and(full, tan)
    return full, (x0, y0, x1 - x0, y1 - y0)


def main() -> None:
    bgr = cv2.imread(SRC, cv2.IMREAD_UNCHANGED)
    if bgr is None:
        raise SystemExit(f"Cannot read {SRC}")
    if bgr.shape[2] == 4:
        bgr = bgr[:, :, :3]

    h, w = bgr.shape[:2]
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)

    logo_mask, _ = build_logo_mask(bgr, gray.astype(np.uint8))
    if logo_mask is None:
        raise SystemExit("Logo mask failed")

    m = logo_mask > 0

    # Tan reference from book (masked area near logo, not B&W)
    ring = cv2.dilate(logo_mask, np.ones((19, 19), np.uint8)) & (~m)
    tan_px = bgr[ring > 0]
    if len(tan_px) > 200:
        tan_bgr = np.median(tan_px, axis=0).astype(np.uint8)
    else:
        tan_bgr = np.array([198, 200, 202], dtype=np.uint8)

    out = np.zeros((h, w, 4), dtype=np.uint8)
    out[:, :, :3] = bgr
    out[:, :, 3] = 255

    work = m
    g = gray
    bch = bgr[:, :, 0].astype(np.float32)
    gch = bgr[:, :, 1].astype(np.float32)
    rch = bgr[:, :, 2].astype(np.float32)
    mx = np.maximum(np.maximum(bch, gch), rch)
    mn = np.minimum(np.minimum(bch, gch), rch)

    # Was white ink / light strokes (broad: catches compressed JPEG-ish off-whites)
    white = work & ((g > 205) | ((mx > 215) & (mn > 155) & (mx - mn < 45)))
    # Was black shield fill
    black = work & (g < 62)

    out[:, :, 0][black] = tan_bgr[0]
    out[:, :, 1][black] = tan_bgr[1]
    out[:, :, 2][black] = tan_bgr[2]
    out[:, :, 3][black] = 0

    out[:, :, 0][white] = 0
    out[:, :, 1][white] = 0
    out[:, :, 2][white] = 0
    out[:, :, 3][white] = 255

    rem = work & ~white & ~black
    # Dark fringe of shield (black–tan): transparent; light fringe (white–tan): black
    sh_edge = rem & (g < 118)
    wh_edge = rem & (g >= 118) & ((mx > 188) | (g > 175))
    keep = rem & ~sh_edge & ~wh_edge

    if np.any(sh_edge):
        t = np.clip((g[sh_edge] - 52.0) / (118.0 - 52.0), 0.0, 1.0)
        out[:, :, 0][sh_edge] = tan_bgr[0]
        out[:, :, 1][sh_edge] = tan_bgr[1]
        out[:, :, 2][sh_edge] = tan_bgr[2]
        out[:, :, 3][sh_edge] = (t * 255.0).astype(np.uint8)

    if np.any(wh_edge):
        t = np.clip((mx[wh_edge] - 160.0) / (245.0 - 160.0), 0.0, 1.0)
        out[:, :, 0][wh_edge] = 0
        out[:, :, 1][wh_edge] = 0
        out[:, :, 2][wh_edge] = 0
        out[:, :, 3][wh_edge] = (t * 255.0).astype(np.uint8)

    if np.any(keep):
        ob = bgr[keep]
        out[:, :, 0][keep] = ob[:, 0]
        out[:, :, 1][keep] = ob[:, 1]
        out[:, :, 2][keep] = ob[:, 2]
        out[:, :, 3][keep] = 255

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    cv2.imwrite(OUT, out)
    print("Wrote", OUT)
    try:
        shutil.copy2(OUT, OUT_CURSOR)
        print("Copied to", OUT_CURSOR)
    except OSError as e:
        print("Copy note:", e)


if __name__ == "__main__":
    main()
