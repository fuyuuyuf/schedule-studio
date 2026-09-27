"""保持用户图标构图，仅生成托盘使用的缩小版本。"""

from pathlib import Path
import sys
from PIL import Image, ImageDraw, ImageChops

SOURCE = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "mod" / "sticker-widget" / "texture" / "tubiao.png"
ASSETS = Path(__file__).resolve().parent / "assets"
ASSETS.mkdir(exist_ok=True)

with Image.open(SOURCE) as source:
    # 高分辨率绘制边框再缩小，保证 16 像素托盘图标仍有清晰白边。
    size = 1024
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.ellipse((6, 6, size - 7, size - 7), fill="#ffffff", outline="#073642", width=9)
    inset = 61
    diameter = size - inset * 2
    face = source.convert("RGBA").resize((diameter, diameter), Image.Resampling.LANCZOS)
    inner_circle = Image.new("L", (diameter, diameter), 0)
    ImageDraw.Draw(inner_circle).ellipse((0, 0, diameter - 1, diameter - 1), fill=255)
    face.putalpha(ImageChops.multiply(face.getchannel("A"), inner_circle))
    image.alpha_composite(face, (inset, inset))
    image.resize((128, 128), Image.Resampling.LANCZOS).save(ASSETS / "tray.png")
    # Windows 原生托盘组件使用 DIB 图标更稳定。
    image.save(ASSETS / "tray.ico", format="ICO", bitmap_format="bmp", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64)])
