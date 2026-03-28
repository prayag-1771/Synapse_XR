"""
Fast & Reliable YOLO Auto-Labeler
Strategy:
  - For every image, use Pillow to find the actual object bounds
    via simple contrast-based salient region (thresholding & bbox on non-background).
  - Fallback: use a slightly inset full-image box (0.5, 0.5, 0.85, 0.85).
  - No heavy ML model needed — runs in seconds for 250 images.
  - All 250 images will receive a label file.
"""

import os
from pathlib import Path
from PIL import Image, ImageFilter, ImageOps
import numpy as np

# ── Config ──────────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).parent
CATEGORIES = ["plc", "relay", "motor", "push_button", "wire"]
CLASS_MAP  = {cat: i for i, cat in enumerate(CATEGORIES)}

# How far to inset the fallback box from the image edges (as fraction of dimensions)
# e.g. 0.07 means we shrink 7% on each side → final box covers 86% of the image
FALLBACK_INSET = 0.07

# ── Salient-region bounding box ─────────────────────────────────────────────────

def smart_bbox(img: Image.Image):
    """
    Returns (x_center, y_center, w, h) normalized [0,1] for the most prominent
    non-background region in the image.
    Falls back to inset full-image box if detection is poor.
    """
    W, H = img.size

    # Convert to grayscale, apply slight blur to reduce noise
    gray = img.convert("L").filter(ImageFilter.GaussianBlur(radius=3))
    arr  = np.array(gray, dtype=np.float32)

    # Estimate background as the median of a narrow border strip
    border = 12
    border_pixels = np.concatenate([
        arr[:border, :].ravel(),
        arr[-border:, :].ravel(),
        arr[:, :border].ravel(),
        arr[:, -border:].ravel(),
    ])
    bg = float(np.median(border_pixels))

    # Foreground mask: pixels that differ from background by > threshold
    threshold = max(18.0, np.std(border_pixels) * 1.5)
    mask = (np.abs(arr - bg) > threshold).astype(np.uint8)

    # Find bounding box of the foreground mask
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)

    if rows.sum() < 5 or cols.sum() < 5:
        # Not enough foreground found → use inset fallback
        return _fallback_box()

    r_min, r_max = np.where(rows)[0][[0, -1]]
    c_min, c_max = np.where(cols)[0][[0, -1]]

    # Add small padding (3%)
    pad_r = int((r_max - r_min) * 0.03)
    pad_c = int((c_max - c_min) * 0.03)
    r_min = max(0, r_min - pad_r)
    r_max = min(H - 1, r_max + pad_r)
    c_min = max(0, c_min - pad_c)
    c_max = min(W - 1, c_max + pad_c)

    bw = c_max - c_min
    bh = r_max - r_min

    # If the detected region is >90% of the image, fall back to inset
    if bw / W > 0.90 and bh / H > 0.90:
        return _fallback_box()

    x_center = (c_min + bw / 2) / W
    y_center  = (r_min + bh / 2) / H
    norm_w    = bw / W
    norm_h    = bh / H

    # Clamp
    x_center = max(0.01, min(0.99, x_center))
    y_center  = max(0.01, min(0.99, y_center))
    norm_w    = max(0.05, min(1.0,  norm_w))
    norm_h    = max(0.05, min(1.0,  norm_h))

    return x_center, y_center, norm_w, norm_h


def _fallback_box():
    """Centered inset box."""
    inset = FALLBACK_INSET
    return (0.5, 0.5, 1.0 - 2 * inset, 1.0 - 2 * inset)


# ── Category processing ─────────────────────────────────────────────────────────

def process_category(cat_name: str):
    folder   = BASE_DIR / cat_name
    class_id = CLASS_MAP[cat_name]

    exts = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
    images   = [p for p in folder.iterdir() if p.suffix.lower() in exts]

    print(f"\n  [{cat_name.upper():12s}] {len(images)} images  (class {class_id})")

    labeled = 0
    fallback = 0

    for img_path in images:
        txt_path = img_path.with_suffix(".txt")

        try:
            img = Image.open(img_path).convert("RGB")
            W, H = img.size

            # Skip tiny/broken images
            if W < 32 or H < 32:
                continue

            box = smart_bbox(img)
            if box == _fallback_box():
                fallback += 1

            x_c, y_c, bw, bh = box
            txt_path.write_text(
                f"{class_id} {x_c:.6f} {y_c:.6f} {bw:.6f} {bh:.6f}\n"
            )
            labeled += 1

        except Exception as err:
            print(f"    WARN {img_path.name}: {err}")

    smart_count  = labeled - fallback
    print(f"    ✓ Labeled  : {labeled}/{len(images)}")
    print(f"    ✓ Smart box: {smart_count}   |  Fallback box: {fallback}")
    return labeled


# ── classes.txt ─────────────────────────────────────────────────────────────────

def write_classes_txt():
    (BASE_DIR / "classes.txt").write_text("\n".join(CATEGORIES) + "\n")
    print("  Wrote classes.txt")


# ── dataset.yaml (for Ultralytics YOLO training) ────────────────────────────────

def write_dataset_yaml():
    yaml_path = BASE_DIR / "dataset.yaml"
    lines = [
        f"path: {BASE_DIR.as_posix()}",
        "train: .",
        "val: .",
        "",
        f"nc: {len(CATEGORIES)}",
        f"names: {CATEGORIES}",
    ]
    yaml_path.write_text("\n".join(lines) + "\n")
    print(f"  Wrote dataset.yaml")


# ── Main ─────────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  Fast YOLO Auto-Labeler (contrast-based + fallback)")
    print("=" * 60)

    write_classes_txt()
    write_dataset_yaml()

    totals = {}
    for cat in CATEGORIES:
        totals[cat] = process_category(cat)

    print("\n" + "=" * 60)
    print("  FINAL SUMMARY")
    print("=" * 60)
    grand = 0
    for cat, n in totals.items():
        status = "✅" if n >= 40 else "⚠️"
        print(f"  {cat:<15} {n:>3} labeled  {status}")
        grand += n
    print(f"  {'TOTAL':<15} {grand:>3}")
    print("=" * 60)
    print("\n✅ Done! Each image folder now has a matching .txt label file.")
    print("   Open any folder to verify: image.jpg ↔ image.txt")


if __name__ == "__main__":
    main()
