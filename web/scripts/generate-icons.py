#!/usr/bin/env python3
"""Generate PhoneHome app icons from Illustrator SVG glyphs (rotary phone + UFO)."""

from __future__ import annotations

import json
import struct
import subprocess
import tempfile
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
WEB_SRC = ROOT / "web" / "src"
WEB_PUBLIC = ROOT / "web" / "public"
IOS_ASSETS = ROOT / "mobile" / "ios" / "App" / "App" / "Assets.xcassets"
MAC_ASSETS = ROOT / "macos" / "Mothership" / "App" / "Assets.xcassets"

PHONE_GLYPH = WEB_SRC / "rotary-phone.svg"
UFO_GLYPH = WEB_SRC / "ufo.svg"

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

MAC_ICON_SIZES: list[tuple[str, int, str]] = [
    ("16x16", 16, "icon_16x16.png"),
    ("16x16", 32, "icon_16x16@2x.png"),
    ("32x32", 32, "icon_32x32.png"),
    ("32x32", 64, "icon_32x32@2x.png"),
    ("128x128", 128, "icon_128x128.png"),
    ("128x128", 256, "icon_128x128@2x.png"),
    ("256x256", 256, "icon_256x256.png"),
    ("256x256", 512, "icon_256x256@2x.png"),
    ("512x512", 512, "icon_512x512.png"),
    ("512x512", 1024, "icon_512x512@2x.png"),
]


def hex_rgb(color: str) -> tuple[int, int, int]:
    color = color.lstrip("#")
    return tuple(int(color[i : i + 2], 16) for i in (0, 2, 4))


def lerp(a: int, b: int, t: float) -> int:
    return int(round(a + (b - a) * t))


def mix_rgb(c1: tuple[int, int, int], c2: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return (lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t))


def rounded_mask(size: int, radius: float) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def rasterize_svg(svg_path: Path, size: int) -> Image.Image:
    """Rasterize an SVG via macOS Quick Look (qlmanage)."""
    with tempfile.TemporaryDirectory() as tmp:
        out_dir = Path(tmp)
        result = subprocess.run(
            ["qlmanage", "-t", "-s", str(size), "-o", str(out_dir), str(svg_path)],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(f"qlmanage failed for {svg_path}: {result.stderr.strip()}")
        png_path = out_dir / f"{svg_path.name}.png"
        if not png_path.exists():
            raise FileNotFoundError(f"qlmanage produced no PNG for {svg_path}")
        with Image.open(png_path) as img:
            return img.convert("RGBA")


@lru_cache(maxsize=16)
def load_glyph(svg_path: str, size: int) -> Image.Image:
    path = Path(svg_path)
    if not path.exists():
        raise FileNotFoundError(path)
    if path.suffix.lower() == ".svg":
        return rasterize_svg(path, size)
    with Image.open(path) as img:
        rgba = img.convert("RGBA")
        if rgba.size != (size, size):
            rgba = rgba.resize((size, size), Image.Resampling.LANCZOS)
        return rgba


def glyph_alpha(glyph: Image.Image) -> Image.Image:
    """Ink mask for black or white source glyphs."""
    r, g, b, a = glyph.split()
    lum = Image.merge("RGB", (r, g, b)).convert("L")
    return Image.composite(lum, a, a)


def render_icon(theme_id: str, glyph_src: Path, size: int = 1024) -> Image.Image:
    palette = THEME_PALETTES[theme_id]
    bg0 = hex_rgb(palette["bg0"])
    bg1 = hex_rgb(palette["bg1"])
    glyph_rgb = hex_rgb(palette["glyph"])

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = canvas.load()
    for y in range(size):
        t = y / max(size - 1, 1)
        row = mix_rgb(bg0, bg1, t * 0.55 + 0.2)
        for x in range(size):
            px[x, y] = (*row, 255)

    vig = Image.new("L", (size, size), 0)
    vdraw = ImageDraw.Draw(vig)
    vdraw.ellipse((-size * 0.15, -size * 0.2, size * 1.15, size * 1.05), fill=210)
    vig = vig.filter(ImageFilter.GaussianBlur(radius=size * 0.08))
    canvas = Image.composite(
        Image.new("RGBA", (size, size), (0, 0, 0, 70)),
        canvas,
        vig,
    )

    glyph = load_glyph(str(glyph_src), max(size, 1024))
    glyph_size = int(size * 0.62)
    glyph = glyph.resize((glyph_size, glyph_size), Image.Resampling.LANCZOS)
    alpha = glyph_alpha(glyph)
    colored = Image.new("RGBA", (glyph_size, glyph_size), (*glyph_rgb, 0))
    colored.putalpha(alpha)
    highlight = Image.new("RGBA", (glyph_size, glyph_size), (255, 255, 255, 0))
    highlight.putalpha(alpha.point(lambda a: int(a * 0.18)))
    colored = Image.alpha_composite(colored, highlight)

    offset = ((size - glyph_size) // 2, int((size - glyph_size) * 0.48))
    canvas.alpha_composite(colored, offset)

    mask = rounded_mask(size, size * 0.223)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(canvas, mask=mask)
    return out


def write_png(path: Path, image: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG", optimize=True)


def write_ico(path: Path, image: Image.Image) -> None:
    """Minimal single-size ICO writer (32x32)."""
    img = image.convert("RGBA").resize((32, 32), Image.Resampling.LANCZOS)
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


def write_icon_svg(path: Path) -> None:
    p = THEME_PALETTES["modern"]
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="PhoneHome">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="{p["bg1"]}"/>
      <stop offset="100%" stop-color="{p["bg0"]}"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="114" fill="url(#bg)"/>
  <image href="/icon-512.png" x="96" y="88" width="320" height="320" preserveAspectRatio="xMidYMid meet"/>
</svg>
'''
    path.write_text(svg, encoding="utf-8")


def appiconset_contents(filename: str) -> dict:
    return {
        "images": [
            {
                "filename": filename,
                "idiom": "universal",
                "platform": "ios",
                "size": "1024x1024",
            }
        ],
        "info": {"author": "xcode", "version": 1},
    }


def write_ios_iconset(name: str, image: Image.Image) -> None:
    folder = IOS_ASSETS / name
    folder.mkdir(parents=True, exist_ok=True)
    fname = "AppIcon-512@2x.png"
    write_png(folder / fname, image)
    (folder / "Contents.json").write_text(
        json.dumps(appiconset_contents(fname), indent=2) + "\n",
        encoding="utf-8",
    )


def write_mac_iconset(image: Image.Image) -> None:
    folder = MAC_ASSETS / "AppIcon.appiconset"
    folder.mkdir(parents=True, exist_ok=True)
    entries: list[dict] = []
    for logical_size, px, filename in MAC_ICON_SIZES:
        scale = "2x" if px > int(logical_size.split("x")[0]) else "1x"
        write_png(folder / filename, image.resize((px, px), Image.Resampling.LANCZOS))
        entries.append(
            {
                "filename": filename,
                "idiom": "mac",
                "scale": scale,
                "size": logical_size,
            }
        )
    (folder / "Contents.json").write_text(
        json.dumps({"images": entries, "info": {"author": "xcode", "version": 1}}, indent=2) + "\n",
        encoding="utf-8",
    )


def write_menubar_iconset(glyph_src: Path) -> None:
    """Template-style menu bar glyph (black ink, alpha mask)."""
    folder = MAC_ASSETS / "MenuBarIcon.imageset"
    folder.mkdir(parents=True, exist_ok=True)
    images: list[dict] = []
    for scale, px, suffix in (("1x", 18, ""), ("2x", 36, "@2x")):
        glyph = load_glyph(str(glyph_src), px * 8)
        glyph = glyph.resize((px, px), Image.Resampling.LANCZOS)
        alpha = glyph_alpha(glyph)
        ink = Image.new("RGBA", (px, px), (0, 0, 0, 255))
        ink.putalpha(alpha)
        fname = f"MenuBarIcon{suffix}.png"
        write_png(folder / fname, ink)
        images.append({"filename": fname, "idiom": "universal", "scale": scale})
    (folder / "Contents.json").write_text(
        json.dumps(
            {
                "images": images,
                "info": {"author": "xcode", "version": 1},
                "properties": {"template-rendering-intent": "template"},
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def main() -> None:
    if not PHONE_GLYPH.exists():
        raise SystemExit(f"Missing phone glyph: {PHONE_GLYPH}")
    if not UFO_GLYPH.exists():
        raise SystemExit(f"Missing UFO glyph: {UFO_GLYPH}")

    icons: dict[str, Image.Image] = {}
    for theme_id in THEME_PALETTES:
        icons[theme_id] = render_icon(theme_id, PHONE_GLYPH, 1024)

    modern = icons["modern"]

    write_png(WEB_SRC / "icon-1024.png", modern)
    write_png(WEB_PUBLIC / "icon-1024.png", modern)
    write_png(WEB_SRC / "icon-512.png", modern.resize((512, 512), Image.Resampling.LANCZOS))
    write_png(WEB_PUBLIC / "icon-512.png", modern.resize((512, 512), Image.Resampling.LANCZOS))
    write_png(WEB_SRC / "apple-touch-icon.png", modern.resize((180, 180), Image.Resampling.LANCZOS))
    write_png(WEB_PUBLIC / "apple-touch-icon.png", modern.resize((180, 180), Image.Resampling.LANCZOS))
    write_png(WEB_SRC / "favicon-32.png", modern.resize((32, 32), Image.Resampling.LANCZOS))
    write_png(WEB_PUBLIC / "favicon-32.png", modern.resize((32, 32), Image.Resampling.LANCZOS))
    write_png(WEB_SRC / "favicon-16.png", modern.resize((16, 16), Image.Resampling.LANCZOS))
    write_png(WEB_PUBLIC / "favicon-16.png", modern.resize((16, 16), Image.Resampling.LANCZOS))
    write_ico(WEB_SRC / "favicon.ico", modern)
    write_ico(WEB_PUBLIC / "favicon.ico", modern)
    write_icon_svg(WEB_SRC / "icon.svg")
    write_icon_svg(WEB_PUBLIC / "icon.svg")

    write_ios_iconset("AppIcon.appiconset", modern)
    for theme_id, image in icons.items():
        if theme_id == "modern":
            continue
        write_ios_iconset(f"AppIcon-{theme_id}.appiconset", image)

    mothership = render_icon("modern", UFO_GLYPH, 1024)
    write_mac_iconset(mothership)
    write_menubar_iconset(UFO_GLYPH)

    print(
        f"Generated {len(icons)} phone icon variants, web favicons, "
        "macOS Mothership AppIcon + MenuBarIcon"
    )


if __name__ == "__main__":
    main()
