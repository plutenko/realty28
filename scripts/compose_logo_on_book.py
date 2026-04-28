#!/usr/bin/env python3
"""Composite SOBR shield logo onto book cover with perspective correction."""
import os
import shutil
from typing import Optional

import cv2
import numpy as np

BASE = "/Users/plutenko/.cursor/projects/Users-plutenko-Documents-Cursor-AI/assets/wolf-accountant-tie-vladis-red.png"
LOGO = "/Users/plutenko/.cursor/projects/Users-plutenko-Documents-Cursor-AI/assets/2026-04-11_18.43.58-e71e66c6-4ebc-43f1-ba16-e6c5b634a6c3.png"
OUT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "assets",
    "wolf-accountant-sobr-logo-composited.png",
)
OUT_CURSOR = "/Users/plutenko/.cursor/projects/Users-plutenko-Documents-Cursor-AI/assets/wolf-accountant-sobr-logo-composited.png"

# Post-adjustments to the destination quad (after automatic book detection)
ROT_CCW_DEG = 25.0  # degrees, OpenCV: positive = counter-clockwise (30° then −5° clockwise)
SHIFT_DOWN_PX = 22  # move logo slightly lower on the cover


def order_points(pts: np.ndarray) -> np.ndarray:
    """Order quad corners as TL, TR, BR, BL (consistent with warp src)."""
    pts = np.array(pts, dtype=np.float32)
    x_sorted = pts[np.argsort(pts[:, 0]), :]
    left = x_sorted[:2, :]
    right = x_sorted[2:, :]
    left = left[np.argsort(left[:, 1]), :]
    (tl, bl) = left
    right = right[np.argsort(right[:, 1]), :]
    (tr, br) = right
    return np.array([tl, tr, br, bl], dtype=np.float32)


def find_book_quad(img_bgr: np.ndarray) -> Optional[np.ndarray]:
    """Return 4x2 float32 corners of book front cover (TL, TR, BR, BL)."""
    h, w = img_bgr.shape[:2]
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    lower = np.array([8, 30, 80])
    upper = np.array([35, 180, 255])
    mask = cv2.inRange(hsv, lower, upper)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))

    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return None
    cnt = max(cnts, key=cv2.contourArea)
    if cv2.contourArea(cnt) < (h * w) * 0.005:
        return None

    # Spine + cover share one tan blob; minAreaRect / ellipse on the full blob skews "flat".
    # Use the right-hand band of the bbox so the quad matches the front cover plane.
    bx, by, bw, bh = cv2.boundingRect(cnt)
    x0 = int(bx + 0.33 * bw)
    sub = np.zeros_like(mask)
    sub[by : by + bh, x0 : bx + bw] = mask[by : by + bh, x0 : bx + bw]
    sub_cnts, _ = cv2.findContours(sub, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if sub_cnts:
        cnt2 = max(sub_cnts, key=cv2.contourArea)
        if cv2.contourArea(cnt2) > (h * w) * 0.003 and len(cnt2) >= 5:
            cnt = cnt2

    if len(cnt) < 5:
        return None
    (cx, cy), (axis_a, axis_b), angle = cv2.fitEllipse(cnt)
    pts = cv2.boxPoints(
        ((float(cx), float(cy)), (float(axis_a), float(axis_b)), float(angle))
    ).astype(np.float32)
    ordered = order_points(pts)

    def inset_quad(q: np.ndarray, margin: float) -> np.ndarray:
        c = q.mean(axis=0)
        return c + (1.0 - margin) * (q - c)

    return inset_quad(ordered, 0.10)


def logo_alpha_from_bgr(logo_bgr: np.ndarray) -> np.ndarray:
    """White-on-black logo: opacity from luminance (no alpha channel in file)."""
    gray = cv2.cvtColor(logo_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    # soften black background; keep white glyphs opaque
    return np.clip((gray - 12.0) / 243.0, 0.0, 1.0)


def adjust_dst_quad(dst: np.ndarray) -> np.ndarray:
    """Rotate quad CCW around its centroid, then shift down (image y+)."""
    dst = np.asarray(dst, dtype=np.float32)
    c = dst.mean(axis=0)
    m = cv2.getRotationMatrix2D((float(c[0]), float(c[1])), ROT_CCW_DEG, 1.0)
    corners = dst.reshape(1, 4, 2)
    out = cv2.transform(corners, m).reshape(4, 2)
    out[:, 1] += float(SHIFT_DOWN_PX)
    return out.astype(np.float32)


def main() -> None:
    base = cv2.imread(BASE, cv2.IMREAD_UNCHANGED)
    logo = cv2.imread(LOGO, cv2.IMREAD_UNCHANGED)
    if base is None or logo is None:
        raise SystemExit(f"Missing files: base={base is not None} logo={logo is not None}")

    if base.shape[2] == 4:
        bgr = base[:, :, :3]
        ba = base[:, :, 3].astype(np.float32) / 255.0
    else:
        bgr = base
        ba = np.ones((base.shape[0], base.shape[1]), dtype=np.float32)

    h, w = bgr.shape[:2]
    quad = find_book_quad(bgr)
    if quad is None:
        raise SystemExit("Could not detect book; tune HSV mask.")

    logo_bgr = logo[:, :, :3]
    lh, lw = logo_bgr.shape[:2]
    src = np.array([[0, 0], [lw - 1, 0], [lw - 1, lh - 1], [0, lh - 1]], dtype=np.float32)
    dst = adjust_dst_quad(quad.astype(np.float32))

    M = cv2.getPerspectiveTransform(src, dst)

    a_src = logo_alpha_from_bgr(logo_bgr)
    alpha = cv2.warpPerspective(
        a_src,
        M,
        (w, h),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=0,
    )

    a = np.clip(alpha * ba, 0, 1)
    a3 = np.stack([a, a, a], axis=-1)
    # White logo → black ink on the book; blend using alpha only
    comp = (bgr.astype(np.float32) * (1.0 - a3)).astype(np.uint8)

    out = np.zeros((h, w, 4), dtype=np.uint8)
    out[:, :, :3] = comp
    out[:, :, 3] = (np.clip(ba, 0, 1) * 255).astype(np.uint8)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    cv2.imwrite(OUT, out)
    print("Wrote", OUT)

    try:
        shutil.copy2(OUT, OUT_CURSOR)
        print("Copied to", OUT_CURSOR)
    except OSError as e:
        print("Note: could not copy to Cursor assets:", e)


if __name__ == "__main__":
    main()
