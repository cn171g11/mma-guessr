# -*- coding: utf-8 -*-
"""从 assets/icon.png (1024x1024) 生成 Android 全部 mipmap 图标。"""
from PIL import Image, ImageDraw
import os

ICON = "assets/icon.png"
RES = "android/app/src/main/res"

sizes = {
    "mdpi": (48, 108),
    "hdpi": (72, 162),
    "xhdpi": (96, 216),
    "xxhdpi": (144, 324),
    "xxxhdpi": (192, 432),
}

icon = Image.open(ICON).convert("RGBA")

for dpi, (launcher, fg) in sizes.items():
    d = os.path.join(RES, f"mipmap-{dpi}")
    os.makedirs(d, exist_ok=True)

    # 方形主图标
    icon.resize((launcher, launcher), Image.LANCZOS).save(os.path.join(d, "ic_launcher.png"))

    # 圆形图标（圆形蒙版）
    round_img = Image.new("RGBA", (launcher, launcher), (0, 0, 0, 0))
    mask = Image.new("L", (launcher, launcher), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, launcher, launcher), fill=255)
    round_img.paste(icon.resize((launcher, launcher), Image.LANCZOS), (0, 0), mask)
    round_img.save(os.path.join(d, "ic_launcher_round.png"))

    # 自适应前景（透明底 + 图标 66% 居中）
    fg_img = Image.new("RGBA", (fg, fg), (0, 0, 0, 0))
    inner = int(fg * 0.66)
    pad = (fg - inner) // 2
    fg_img.paste(icon.resize((inner, inner), Image.LANCZOS), (pad, pad))
    fg_img.save(os.path.join(d, "ic_launcher_foreground.png"))

print("OK: 图标已生成")
