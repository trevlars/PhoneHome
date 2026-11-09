#!/usr/bin/env python3
"""Generate PhoneHome app icons from the Illustrator SVG originals.

Sources (web/src):
  rotary-phone-source.svg  desk phone -> web favicons / PWA icons, iOS AppIcon (+ theme alternates),
                           Android adaptive launcher (plate and glyph are separate layers)
  ufo.svg                  UFO        -> macOS Mothership AppIcon + menu bar template icon

Also rewrites web/src/rotary-phone.svg (the runtime CSS mask glyph) as a square-cropped
*vector* copy of the source so the in-app mark stays crisp at any size.

SVG rasterizer, first available wins:
  cairosvg (pip install cairosvg pillow)  ->  rsvg-convert (librsvg)  ->  AppKit via `swift` (macOS)
Quick Look (qlmanage) is deliberately not used: it flattens SVGs onto opaque white.

Run from anywhere:  python3 web/scripts/generate-icons.py
"""

from __future__ import annotations

import io
import json
import shutil
import struct
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
WEB_SRC = ROOT / "web" / "src"
WEB_PUBLIC = ROOT / "web" / "public"
IOS_ASSETS = ROOT / "mobile" / "ios" / "App" / "App" / "Assets.xcassets"
MAC_ASSETS = ROOT / "macos" / "Mothership" / "App" / "Assets.xcassets"
ANDROID_RES = ROOT / "mobile" / "android" / "app" / "src" / "main" / "res"

PHONE_SRC = WEB_SRC / "rotary-phone-source.svg"
UFO_SRC = WEB_SRC / "ufo.svg"
PHONE_MASK_SVG = "rotary-phone.svg"

SVG_NS = "http://www.w3.org/2000/svg"
SHAPE_TAGS = {"path", "polygon", "polyline", "rect", "circle", "ellipse", "line"}
SKIP_TAGS = {"defs", "style", "metadata", "title", "desc"}
DROP_ATTRS = {"class", "style", "fill", "id"}

RASTER_SIDE = 2048

# Glyph width as a fraction of its plate. The phone value reproduces the shipped iOS icon.
PHONE_GLYPH_RATIO = 0.78
# Android adaptive canvas is 108dp. Anything past the center 66dp can be clipped by a
# circle mask, which is what cut the handset and cord off the old full-bleed foreground.
# 0.54 * 108 = 58dp, inside that 66dp circle.
ANDROID_GLYPH_RATIO = 0.54
ANDROID_DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
UFO_GLYPH_RATIO = 0.72
# icon.svg is declared "maskable": keep the mark inside the 80% safe circle.
SVG_ICON_GLYPH_RATIO = 0.64
# Square-crop framing of rotary-phone.svg; app.css mask-size (118%) was tuned for this.
PHONE_MASK_FILL = 0.926
# The full UFO scene is unreadable at 18pt: the menu bar glyph is just the saucer, i.e. the
# top band of the artwork (fractions of the source viewBox, above where the beam starts).
MENUBAR_SOURCE_BAND = (0.0, 0.0, 1.0, 0.505)

# macOS does not mask app icons: the rounded plate is drawn at Apple's 824pt size on a
# 1024 canvas, with transparent margins and a soft shadow.
MAC_CANVAS = 1024
MAC_PLATE = 824
MAC_RADIUS_RATIO = 0.225

# iOS home-screen mask is a continuous-corner squircle (~superellipse n=5).
IOS_SQUIRCLE_EXPONENT = 5.0
# Ring sits this far inside the mask so no iOS mask variant (or Lanczos downscale) clips it.
IOS_RING_INSET_RATIO = 0.045
IOS_RING_WIDTH_RATIO = 0.006
SUPERSAMPLE = 4
LAUNCH_BRAND_PNG = ROOT / "mobile" / "ios" / "App" / "App" / "LaunchMark.png"
# Nudge rotary art up slightly (source SVG has extra footroom).
PHONE_ICON_Y_BIAS = 0.0

MAC_ICON_SIZES: list[tuple[str, str, int]] = [
    ("16x16", "1x", 16),
    ("16x16", "2x", 32),
    ("32x32", "1x", 32),
    ("32x32", "2x", 64),
    ("128x128", "1x", 128),
    ("128x128", "2x", 256),
    ("256x256", "1x", 256),
    ("256x256", "2x", 512),
    ("512x512", "1x", 512),
    ("512x512", "2x", 1024),
]

# bg0/bg1/glyph mirror web/src/app.js + app.css theme tokens.
THEME_PALETTES: dict[str, dict[str, str]] = {
    "modern": {"bg0": "#0e1a15", "bg1": "#14241e", "glyph": "#f3cb5c"},
    "retro90s": {"bg0": "#2a1848", "bg1": "#3d2468", "glyph": "#ffd24a"},
    "aero2000s": {"bg0": "#2a6a9a", "bg1": "#3a8fc4", "glyph": "#0a4060"},
    "tunes2000s": {"bg0": "#4a5058", "bg1": "#6e7580", "glyph": "#f5f0e6"},
    "gba2000s": {"bg0": "#1a4a1a", "bg1": "#2d6b2d", "glyph": "#0f380f"},
    "cartoon2000s": {"bg0": "#1a5a9a", "bg1": "#3d9bfd", "glyph": "#f5c542"},
    "millennialGray": {"bg0": "#7a7770", "bg1": "#9a968f", "glyph": "#2c2a28"},
    "xenon2000s": {"bg0": "#6a1a8a", "bg1": "#c44dff", "glyph": "#ff4fd8"},
    "wood70s": {"bg0": "#1e1008", "bg1": "#2a1810", "glyph": "#d4a84b"},
    "bit1632": {"bg0": "#120820", "bg1": "#1a1030", "glyph": "#f5c542"},
    "windbreaker80s": {"bg0": "#064840", "bg1": "#0a5c4f", "glyph": "#ffb000"},
    "dad80s": {"bg0": "#2a4a78", "bg1": "#3a5a8c", "glyph": "#f5f0e6"},
    "tomspace": {"bg0": "#aa0066", "bg1": "#ff00aa", "glyph": "#ff69c8"},
    "emo2000s": {"bg0": "#100008", "bg1": "#1a0a12", "glyph": "#6b2a3a"},
    "baja": {"bg0": "#008880", "bg1": "#00b2a9", "glyph": "#e0a824"},
    "flat2013": {"bg0": "#0066d6", "bg1": "#007aff", "glyph": "#ffffff"},
    "craigslist": {"bg0": "#d8d0d8", "bg1": "#eee8ee", "glyph": "#0000ee"},
    "backrooms": {"bg0": "#9a8a40", "bg1": "#c4b45a", "glyph": "#ffd24a"},
    "coaster": {"bg0": "#000060", "bg1": "#000080", "glyph": "#ffb000"},
    "dos80s": {"bg0": "#000000", "bg1": "#001800", "glyph": "#33ff33"},
    "highContrast": {"bg0": "#ffffff", "bg1": "#f0f0f0", "glyph": "#000000"},
    "highContrastDark": {"bg0": "#000000", "bg1": "#101010", "glyph": "#ffffff"},
}

RGB = tuple[int, int, int]


def hex_rgb(color: str) -> RGB:
    color = color.lstrip("#")
    return tuple(int(color[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def rgb_hex(rgb: RGB) -> str:
    return "#%02x%02x%02x" % rgb


def mix_rgb(c1: RGB, c2: RGB, t: float) -> RGB:
    return tuple(int(round(a + (b - a) * t)) for a, b in zip(c1, c2))  # type: ignore[return-value]


# --------------------------------------------------------------------------- SVG input


def svg_viewbox(path: Path) -> tuple[float, float, float, float]:
    root = ET.parse(path).getroot()
    vb = root.get("viewBox")
    if vb:
        x, y, w, h = (float(v) for v in vb.replace(",", " ").split())
        return x, y, w, h
    w = float(root.get("width", "1024").rstrip("px"))
    h = float(root.get("height", "1024").rstrip("px"))
    return 0.0, 0.0, w, h


SWIFT_RASTERIZER = r"""
import AppKit
let args = CommandLine.arguments
let src = args[1], w = Int(args[2])!, h = Int(args[3])!, out = args[4]
guard let image = NSImage(contentsOfFile: src) else { exit(2) }
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8,
    samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
    bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
image.draw(in: NSRect(x: 0, y: 0, width: w, height: h), from: .zero, operation: .copy, fraction: 1)
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
"""


def rasterize_svg(path: Path, max_side: int) -> Image.Image:
    """Render an SVG to RGBA on a transparent background, fitted inside max_side."""
    _, _, vb_w, vb_h = svg_viewbox(path)
    scale = max_side / max(vb_w, vb_h)
    width = max(1, round(vb_w * scale))
    height = max(1, round(vb_h * scale))

    try:
        import cairosvg  # type: ignore
    except ImportError:
        cairosvg = None
    if cairosvg is not None:
        png = cairosvg.svg2png(url=str(path), output_width=width, output_height=height)
        return Image.open(io.BytesIO(png)).convert("RGBA")

    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "glyph.png"
        if shutil.which("rsvg-convert"):
            subprocess.run(
                ["rsvg-convert", "-w", str(width), "-h", str(height), "-o", str(out), str(path)],
                check=True,
            )
        elif sys.platform == "darwin" and shutil.which("swift"):
            script = Path(tmp) / "rasterize.swift"
            script.write_text(SWIFT_RASTERIZER)
            subprocess.run(
                ["swift", str(script), str(path), str(width), str(height), str(out)],
                check=True,
                capture_output=True,
            )
        else:
            raise SystemExit(
                "No SVG rasterizer found. Run: pip3 install cairosvg pillow "
                "(or install librsvg for rsvg-convert)."
            )
        with Image.open(out) as img:
            return img.convert("RGBA")


def ink_mask(img: Image.Image) -> Image.Image:
    """Shape coverage as an L mask, for black or white ink on transparent (or white)."""
    alpha = img.getchannel("A")
    lo, _ = alpha.getextrema()
    if lo < 128:
        return alpha
    return ImageChops.invert(img.convert("L"))


@lru_cache(maxsize=None)
def source_mask(svg_path: str) -> Image.Image:
    path = Path(svg_path)
    if not path.exists():
        raise SystemExit(f"Missing glyph source: {path}")
    return ink_mask(rasterize_svg(path, RASTER_SIDE))


def square_fit(mask: Image.Image, size: int, fill: float) -> Image.Image:
    """Crop to the drawn bbox and center it on a size x size canvas at fill of the side."""
    bbox = mask.getbbox()
    if not bbox:
        raise ValueError("glyph mask is empty")
    mask = mask.crop(bbox)
    w, h = mask.size
    scale = size * fill / max(w, h)
    new = (max(1, round(w * scale)), max(1, round(h * scale)))
    mask = mask.resize(new, Image.Resampling.LANCZOS)
    out = Image.new("L", (size, size), 0)
    out.paste(mask, ((size - new[0]) // 2, (size - new[1]) // 2))
    return out


def glyph_mask(svg_path: Path, size: int, fill: float, y_bias: float = 0.0) -> Image.Image:
    mask = square_fit(source_mask(str(svg_path)), size, fill)
    if not y_bias:
        return mask
    out = Image.new("L", (size, size), 0)
    dy = int(round(size * y_bias))
    out.paste(mask, (0, dy))
    return out


def square_viewbox(svg_path: Path, fill: float) -> tuple[float, float, float]:
    """(x, y, side) of a square viewBox centered on the drawn art, in SVG user units."""
    vx, vy, vw, vh = svg_viewbox(svg_path)
    mask = source_mask(str(svg_path))
    bbox = mask.getbbox()
    if not bbox:
        raise ValueError("glyph mask is empty")
    scale = mask.width / vw
    x0, y0 = vx + bbox[0] / scale, vy + bbox[1] / scale
    x1, y1 = vx + bbox[2] / scale, vy + bbox[3] / scale
    side = max(x1 - x0, y1 - y0) / fill
    return (x0 + x1) / 2 - side / 2, (y0 + y1) / 2 - side / 2, side


# --------------------------------------------------------------------------- plate rendering


def plate_colors(theme_id: str) -> tuple[RGB, RGB, RGB]:
    """Plate greens stay close to UI --bg0/--bg1 (tiny glyph tint only).

    Older mixes (bg1+24% glyph) washed modern into a light olive that read
    much brighter than the in-app chrome on the home screen.
    """
    palette = THEME_PALETTES[theme_id]
    bg0 = hex_rgb(palette["bg0"])
    bg1 = hex_rgb(palette["bg1"])
    glyph = hex_rgb(palette["glyph"])
    top = mix_rgb(bg0, glyph, 0.02)
    bottom = mix_rgb(bg1, glyph, 0.06)
    return top, bottom, glyph


def vertical_gradient(size: int, top: RGB, bottom: RGB, ease: float = 1.6) -> Image.Image:
    column = Image.new("RGB", (1, size))
    px = column.load()
    for y in range(size):
        t = (y / max(size - 1, 1)) ** ease
        px[0, y] = mix_rgb(top, bottom, t)
    return column.resize((size, size), Image.Resampling.BILINEAR).convert("RGBA")


def rounded_mask(size: int, radius: float, inset: float = 0.0) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (inset, inset, size - 1 - inset, size - 1 - inset), radius=max(0.0, radius - inset), fill=255
    )
    return mask


def squircle_points(size: float, inset: float, steps: int = 720) -> list[tuple[float, float]]:
    import math

    c = size / 2.0
    half = c - inset
    exp = 2.0 / IOS_SQUIRCLE_EXPONENT
    pts = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        ct, st = math.cos(t), math.sin(t)
        x = c + half * math.copysign(abs(ct) ** exp, ct)
        y = c + half * math.copysign(abs(st) ** exp, st)
        pts.append((x, y))
    return pts


def squircle_mask(size: int, inset: float = 0.0) -> Image.Image:
    """Anti-aliased iOS-style squircle (drawn at SUPERSAMPLE x, then downsampled)."""
    big = size * SUPERSAMPLE
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).polygon(squircle_points(big, inset * SUPERSAMPLE), fill=255)
    return mask.resize((size, size), Image.Resampling.LANCZOS)


def squircle_ring_mask(size: int, inset: float, width: float) -> Image.Image:
    big = size * SUPERSAMPLE
    mask = Image.new("L", (big, big), 0)
    draw = ImageDraw.Draw(mask)
    draw.polygon(squircle_points(big, inset * SUPERSAMPLE), fill=255)
    draw.polygon(squircle_points(big, (inset + width) * SUPERSAMPLE), fill=0)
    return mask.resize((size, size), Image.Resampling.LANCZOS)


def solid_layer(size: int, rgb: RGB, mask: Image.Image, opacity: float) -> Image.Image:
    layer = Image.new("RGBA", (size, size), (*rgb, 0))
    layer.putalpha(mask.point(lambda a: int(a * opacity)))
    return layer


def render_plate(
    theme_id: str,
    size: int,
    radius: float | None = None,
    border: bool = True,
    ios_border: bool = False,
) -> Image.Image:
    """Gradient plate with soft highlight and optional inset border in the glyph colour."""
    top, bottom, glyph = plate_colors(theme_id)
    plate = vertical_gradient(size, top, bottom)

    highlight = Image.new("L", (size, size), 0)
    ImageDraw.Draw(highlight).ellipse(
        (-size * 0.25, -size * 0.35, size * 0.95, size * 0.75), fill=255
    )
    highlight = highlight.filter(ImageFilter.GaussianBlur(radius=size * 0.12))
    plate.alpha_composite(solid_layer(size, (255, 255, 255), highlight, 0.04))

    if border:
        if ios_border:
            border_mask = squircle_ring_mask(
                size, size * IOS_RING_INSET_RATIO, size * IOS_RING_WIDTH_RATIO
            )
            plate.alpha_composite(solid_layer(size, glyph, border_mask, 0.55))
        else:
            inset = size * 0.024
            width = max(1, round(size * 0.0022))
            border_mask = Image.new("L", (size, size), 0)
            draw = ImageDraw.Draw(border_mask)
            box = (inset, inset, size - 1 - inset, size - 1 - inset)
            if radius is None:
                draw.rectangle(box, outline=255, width=width)
            else:
                draw.rounded_rectangle(box, radius=max(0.0, radius - inset), outline=255, width=width)
            plate.alpha_composite(solid_layer(size, glyph, border_mask, 0.48))

    if radius is not None:
        clipped = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        clipped.paste(plate, mask=rounded_mask(size, radius))
        plate = clipped
    return plate


def draw_glyph(plate: Image.Image, mask: Image.Image, glyph: RGB) -> None:
    size = plate.width
    shadow = ImageChops.offset(mask, 0, int(size * 0.008)).filter(
        ImageFilter.GaussianBlur(radius=size * 0.01)
    )
    plate.alpha_composite(solid_layer(size, (0, 0, 0), shadow, 0.45))
    plate.alpha_composite(solid_layer(size, glyph, mask, 1.0))


def render_square_icon(theme_id: str, glyph_src: Path, ratio: float, size: int = 1024) -> Image.Image:
    """Full-bleed square iOS icon — gold inset ring tracks iOS corners; OS applies the mask."""
    plate = render_plate(theme_id, size, border=True, ios_border=True)
    draw_glyph(
        plate,
        glyph_mask(glyph_src, size, ratio, y_bias=PHONE_ICON_Y_BIAS),
        plate_colors(theme_id)[2],
    )
    return plate


def render_mac_icon(theme_id: str, glyph_src: Path, ratio: float) -> Image.Image:
    """macOS app icon: rounded 824pt plate on a transparent 1024 canvas with a soft shadow."""
    radius = MAC_PLATE * MAC_RADIUS_RATIO
    plate = render_plate(theme_id, MAC_PLATE, radius=radius)
    draw_glyph(plate, glyph_mask(glyph_src, MAC_PLATE, ratio), plate_colors(theme_id)[2])

    offset = (MAC_CANVAS - MAC_PLATE) // 2
    canvas = Image.new("RGBA", (MAC_CANVAS, MAC_CANVAS), (0, 0, 0, 0))
    shadow_shape = Image.new("L", (MAC_CANVAS, MAC_CANVAS), 0)
    shadow_shape.paste(rounded_mask(MAC_PLATE, radius), (offset, offset + 10))
    shadow_shape = shadow_shape.filter(ImageFilter.GaussianBlur(radius=12))
    canvas.alpha_composite(solid_layer(MAC_CANVAS, (0, 0, 0), shadow_shape, 0.30))
    canvas.alpha_composite(plate, (offset, offset))
    return canvas


# --------------------------------------------------------------------------- writers


def write_png(path: Path, image: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG", optimize=True)


def write_web_png(name: str, image: Image.Image) -> None:
    write_png(WEB_SRC / name, image)
    write_png(WEB_PUBLIC / name, image)


def resized(image: Image.Image, size: int) -> Image.Image:
    return image.resize((size, size), Image.Resampling.LANCZOS)


def write_ico(path: Path, image: Image.Image) -> None:
    """Minimal single-size ICO writer (32x32)."""
    img = resized(image.convert("RGBA"), 32)
    w, h = img.size
    rgba = img.tobytes()
    bgra = bytearray()
    for y in range(h - 1, -1, -1):
        for x in range(w):
            r, g, b, a = rgba[(y * w + x) * 4 : (y * w + x) * 4 + 4]
            bgra.extend((b, g, r, a))
    bmp = struct.pack("<IIIHHIIIIII", 40, w, h * 2, 1, 32, 0, len(bgra), 0, 0, 0, 0) + bytes(bgra)
    icon_dir = struct.pack("<HHH", 0, 1, 1)
    entry = struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(bmp), 22)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(icon_dir + entry + bmp)


def clean_attrs(attrs: dict[str, str]) -> dict[str, str]:
    return {k: v for k, v in attrs.items() if k not in DROP_ATTRS}


def copy_shapes(src_el: ET.Element, dst_parent: ET.Element) -> None:
    for child in src_el:
        tag = child.tag.split("}")[-1]
        if tag in SKIP_TAGS:
            continue
        if tag == "g":
            group = ET.SubElement(dst_parent, f"{{{SVG_NS}}}g", clean_attrs(child.attrib))
            copy_shapes(child, group)
        elif tag in SHAPE_TAGS:
            ET.SubElement(dst_parent, f"{{{SVG_NS}}}{tag}", clean_attrs(child.attrib))


def svg_text(svg: ET.Element) -> str:
    ET.register_namespace("", SVG_NS)
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(svg, encoding="unicode") + "\n"


def write_mask_svg(src: Path, name: str, fill: float, label: str) -> None:
    """Square-cropped black vector copy of src for CSS mask-image use."""
    x, y, side = square_viewbox(src, fill)
    svg = ET.Element(
        f"{{{SVG_NS}}}svg",
        {"viewBox": f"{x:.2f} {y:.2f} {side:.2f} {side:.2f}", "role": "img", "aria-label": label},
    )
    group = ET.SubElement(svg, f"{{{SVG_NS}}}g", {"fill": "#000"})
    copy_shapes(ET.parse(src).getroot(), group)
    text = svg_text(svg)
    (WEB_SRC / name).write_text(text, encoding="utf-8")
    (WEB_PUBLIC / name).write_text(text, encoding="utf-8")


def write_icon_svg(src: Path, theme_id: str, ratio: float) -> None:
    """Vector favicon / maskable PWA icon: gradient plate + glyph paths."""
    top, bottom, glyph = plate_colors(theme_id)
    size = 512
    x, y, side = square_viewbox(src, 1.0)
    scale = size * ratio / side
    tx = size / 2 - (x + side / 2) * scale
    ty = size / 2 - (y + side / 2) * scale

    svg = ET.Element(
        f"{{{SVG_NS}}}svg",
        {"viewBox": f"0 0 {size} {size}", "role": "img", "aria-label": "PhoneHome"},
    )
    defs = ET.SubElement(svg, f"{{{SVG_NS}}}defs")
    grad = ET.SubElement(
        defs, f"{{{SVG_NS}}}linearGradient", {"id": "bg", "x1": "0", "y1": "0", "x2": "0", "y2": "1"}
    )
    ET.SubElement(grad, f"{{{SVG_NS}}}stop", {"offset": "0", "stop-color": rgb_hex(top)})
    ET.SubElement(grad, f"{{{SVG_NS}}}stop", {"offset": "1", "stop-color": rgb_hex(bottom)})
    filt = ET.SubElement(defs, f"{{{SVG_NS}}}filter", {"id": "shadow", "x": "-10%", "y": "-10%", "width": "120%", "height": "130%"})
    ET.SubElement(
        filt,
        f"{{{SVG_NS}}}feDropShadow",
        {"dx": "0", "dy": "4", "stdDeviation": "5", "flood-color": "#000", "flood-opacity": "0.45"},
    )
    ET.SubElement(svg, f"{{{SVG_NS}}}rect", {"width": str(size), "height": str(size), "fill": "url(#bg)"})
    inset = round(size * 0.024, 1)
    ET.SubElement(
        svg,
        f"{{{SVG_NS}}}rect",
        {
            "x": str(inset),
            "y": str(inset),
            "width": str(round(size - 2 * inset, 1)),
            "height": str(round(size - 2 * inset, 1)),
            "fill": "none",
            "stroke": rgb_hex(glyph),
            "stroke-opacity": "0.45",
            "stroke-width": "1",
        },
    )
    group = ET.SubElement(
        svg,
        f"{{{SVG_NS}}}g",
        {
            "fill": rgb_hex(glyph),
            "filter": "url(#shadow)",
            "transform": f"translate({tx:.3f} {ty:.3f}) scale({scale:.5f})",
        },
    )
    copy_shapes(ET.parse(src).getroot(), group)
    text = svg_text(svg)
    (WEB_SRC / "icon.svg").write_text(text, encoding="utf-8")
    (WEB_PUBLIC / "icon.svg").write_text(text, encoding="utf-8")


def write_contents(folder: Path, images: list[dict], properties: dict | None = None) -> None:
    contents: dict = {"images": images, "info": {"author": "xcode", "version": 1}}
    if properties:
        contents["properties"] = properties
    (folder / "Contents.json").write_text(json.dumps(contents, indent=2) + "\n", encoding="utf-8")


def write_ios_iconset(name: str, image: Image.Image) -> None:
    folder = IOS_ASSETS / name
    folder.mkdir(parents=True, exist_ok=True)
    fname = "AppIcon-512@2x.png"
    write_png(folder / fname, image)
    write_contents(
        folder,
        [{"filename": fname, "idiom": "universal", "platform": "ios", "size": "1024x1024"}],
    )


def write_mac_iconset(image: Image.Image) -> None:
    folder = MAC_ASSETS / "AppIcon.appiconset"
    folder.mkdir(parents=True, exist_ok=True)
    images: list[dict] = []
    for logical, scale, px in MAC_ICON_SIZES:
        fname = f"icon_{logical}{'@2x' if scale == '2x' else ''}.png"
        write_png(folder / fname, resized(image, px))
        images.append({"filename": fname, "idiom": "mac", "scale": scale, "size": logical})
    write_contents(folder, images)


def circle_mask(size: int, diameter_frac: float = 1.0) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    inset = (1.0 - diameter_frac) / 2.0 * size
    ImageDraw.Draw(mask).ellipse((inset, inset, size - 1 - inset, size - 1 - inset), fill=255)
    return mask


def render_android_layers(size: int) -> tuple[Image.Image, Image.Image, Image.Image]:
    """Opaque plate, transparent glyph, and a white monochrome glyph.

    The gold iOS ring is not drawn. It follows the iOS squircle, and a launcher
    mask that is rounder clips it (and the handset) the way the old foreground did.
    """
    _, _, glyph = plate_colors("modern")
    background = render_plate("modern", size, border=False)
    mask = glyph_mask(PHONE_SRC, size, ANDROID_GLYPH_RATIO)
    foreground = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_glyph(foreground, mask, glyph)
    monochrome = solid_layer(size, (255, 255, 255), mask, 1.0)
    return background, foreground, monochrome


def write_android_icons() -> None:
    """Adaptive layers plus legacy square/round fallbacks, one set per density."""
    master = 432
    background, foreground, monochrome = render_android_layers(master)
    full = background.copy()
    full.alpha_composite(foreground)
    squircle = Image.new("RGBA", (master, master), (0, 0, 0, 0))
    squircle.paste(full, mask=squircle_mask(master))
    circle = Image.new("RGBA", (master, master), (0, 0, 0, 0))
    circle.paste(full, mask=circle_mask(master))
    for name, scale in ANDROID_DENSITIES.items():
        folder = ANDROID_RES / f"mipmap-{name}"
        adaptive = int(round(108 * scale))
        legacy = int(round(48 * scale))
        write_png(folder / "ic_launcher_background.png", resized(background, adaptive))
        write_png(folder / "ic_launcher_foreground.png", resized(foreground, adaptive))
        write_png(folder / "ic_launcher_monochrome.png", resized(monochrome, adaptive))
        write_png(folder / "ic_launcher.png", resized(squircle, legacy))
        write_png(folder / "ic_launcher_round.png", resized(circle, legacy))


def write_menubar_iconset(glyph_src: Path) -> None:
    """18pt template image (black ink + alpha) for the MenuBarExtra label."""
    folder = MAC_ASSETS / "MenuBarIcon.imageset"
    folder.mkdir(parents=True, exist_ok=True)
    full = source_mask(str(glyph_src))
    fx0, fy0, fx1, fy1 = MENUBAR_SOURCE_BAND
    saucer = full.crop(
        (round(full.width * fx0), round(full.height * fy0), round(full.width * fx1), round(full.height * fy1))
    )
    images: list[dict] = []
    for scale, px, suffix in (("1x", 18, ""), ("2x", 36, "@2x")):
        mask = square_fit(saucer, px, 0.94)
        fname = f"MenuBarIcon{suffix}.png"
        write_png(folder / fname, solid_layer(px, (0, 0, 0), mask, 1.0))
        images.append({"filename": fname, "idiom": "mac", "scale": scale})
    write_contents(folder, images, {"template-rendering-intent": "template"})


# --------------------------------------------------------------------------- main


def main() -> None:
    for src in (PHONE_SRC, UFO_SRC):
        if not src.exists():
            raise SystemExit(f"Missing glyph source: {src}")

    icons = {
        theme_id: render_square_icon(theme_id, PHONE_SRC, PHONE_GLYPH_RATIO) for theme_id in THEME_PALETTES
    }
    modern = icons["modern"]

    write_web_png("icon-1024.png", modern)
    write_web_png("icon-512.png", resized(modern, 512))
    write_web_png("apple-touch-icon.png", resized(modern, 180))
    write_web_png("favicon-32.png", resized(modern, 32))
    write_web_png("favicon-16.png", resized(modern, 16))
    write_ico(WEB_SRC / "favicon.ico", modern)
    write_ico(WEB_PUBLIC / "favicon.ico", modern)
    write_icon_svg(PHONE_SRC, "modern", SVG_ICON_GLYPH_RATIO)
    write_mask_svg(PHONE_SRC, PHONE_MASK_SVG, PHONE_MASK_FILL, "rotary phone")

    write_ios_iconset("PhoneHomeAppIcon.appiconset", modern)
    # Launch screen isn't OS-masked — bake the squircle into alpha so corners aren't sharp.
    launch = Image.new("RGBA", modern.size, (0, 0, 0, 0))
    launch.paste(modern, mask=squircle_mask(modern.width))
    write_png(LAUNCH_BRAND_PNG, launch)
    for theme_id, image in icons.items():
        if theme_id != "modern":
            write_ios_iconset(f"AppIcon-{theme_id}.appiconset", image)

    write_mac_iconset(render_mac_icon("modern", UFO_SRC, UFO_GLYPH_RATIO))
    write_menubar_iconset(UFO_SRC)
    write_android_icons()

    print(
        f"Generated {len(icons)} phone icon variants, web favicons + icon.svg, "
        f"{PHONE_MASK_SVG} vector mask, macOS Mothership AppIcon + MenuBarIcon, "
        "Android adaptive launcher"
    )


if __name__ == "__main__":
    main()
