#!/usr/bin/env python3
"""Crop desktop screenshots and apply transparent rounded corners."""
from PIL import Image, ImageDraw
import os, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(ROOT, "..", "desktop", "assets")
DST_DIR = os.path.join(ROOT, "public", "images")
BUILD_DIR = os.path.join(ROOT, "..", "desktop", "build")

os.makedirs(DST_DIR, exist_ok=True)

def crop_with_radius(fname, pad, radius, out_name=None):
    src = os.path.join(SRC_DIR, fname)
    dst = os.path.join(DST_DIR, out_name or fname)
    if not os.path.exists(src):
        print(f"  skip {fname} (not found)")
        return
    img = Image.open(src).convert("RGBA")
    w, h = img.size
    cropped = img.crop((pad, pad, w - pad, h - pad))
    cw, ch = cropped.size
    mask = Image.new("L", (cw, ch), 0)
    ImageDraw.Draw(mask).rounded_rectangle([(0, 0), (cw - 1, ch - 1)], radius=radius, fill=255)
    r, g, b, _ = cropped.split()
    Image.merge("RGBA", (r, g, b, mask)).save(dst, "PNG")
    print(f"  {fname} → {out_name or fname}: {w}x{h} → {cw}x{ch} (r={radius})")

# Original full-app screenshots (120px colorful padding, 24px corner radius)
for f in ["plan.png", "code.png", "review.png", "usage.png", "design.png"]:
    crop_with_radius(f, 120, 24)

# Landing-specific crops sourced from desktop exports (57px colored border).
crop_with_radius("hero-candidate-with-border.png", 57, 24, "hero-candidate.png")
crop_with_radius("finish-pr-with-border.png", 57, 24, "finish-pr.png")

# multi-window (57px padding, 22px corner radius)
crop_with_radius("multi-window.png", 57, 22)

# Logos + icon
for logo in ["logo-mono.png", "logo-mono-dark.png"]:
    src = os.path.join(BUILD_DIR, logo)
    dst = os.path.join(ROOT, "public", logo)
    if os.path.exists(src):
        shutil.copy2(src, dst)
        print(f"  {logo}: copied")

icon_src = os.path.join(BUILD_DIR, "icon.png")
icon_dst = os.path.join(ROOT, "src", "app", "icon.png")
if os.path.exists(icon_src):
    shutil.copy2(icon_src, icon_dst)
    print(f"  icon.png: copied")
