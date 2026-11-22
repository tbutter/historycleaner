#!/usr/bin/env python3
"""Generate crisp supersampled PNG icons (16, 32, 48, 128) for History Cleaner."""

from pathlib import Path
from PIL import Image, ImageDraw


def draw_icon(size: int) -> Image.Image:
    scale = 8
    canvas_size = size * scale
    img = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    pad = int(canvas_size * 0.06)
    radius = int(canvas_size * 0.23)

    # Deep slate-blue squircle background with subtle inner highlight
    bg_box = [pad, pad, canvas_size - pad, canvas_size - pad]
    draw.rounded_rectangle(bg_box, radius=radius, fill=(19, 41, 61, 255))

    inner_pad = pad + max(scale, int(canvas_size * 0.02))
    inner_box = [inner_pad, inner_pad, canvas_size - inner_pad, canvas_size - inner_pad]
    draw.rounded_rectangle(
        inner_box,
        radius=max(1, radius - scale),
        outline=(46, 94, 138, 160),
        width=max(scale, int(canvas_size * 0.02)),
    )

    cx = canvas_size * 0.5
    cy = canvas_size * 0.5
    ring_r = canvas_size * 0.27
    stroke = max(scale * 2, int(canvas_size * 0.075))

    # Clock/history outer arc (teal-cyan)
    arc_box = [
        int(cx - ring_r),
        int(cy - ring_r),
        int(cx + ring_r),
        int(cy + ring_r),
    ]
    draw.arc(arc_box, start=35, end=315, fill=(56, 189, 248, 255), width=stroke)

    # Counter-clockwise history arrow head near top-right (315 deg)
    tip_x = cx + ring_r * 0.72
    tip_y = cy - ring_r * 0.72
    arrow_size = canvas_size * 0.11
    arrow_pts = [
        (tip_x + arrow_size * 0.45, tip_y + arrow_size * 0.25),
        (tip_x - arrow_size * 0.65, tip_y + arrow_size * 0.35),
        (tip_x - arrow_size * 0.10, tip_y - arrow_size * 0.70),
    ]
    draw.polygon(arrow_pts, fill=(56, 189, 248, 255))

    # Regex slash + asterisk / sweep accent in warm coral-amber at center
    slash_w = max(scale * 2, int(canvas_size * 0.068))
    draw.line(
        [
            (cx - ring_r * 0.38, cy + ring_r * 0.42),
            (cx + ring_r * 0.12, cy - ring_r * 0.42),
        ],
        fill=(248, 250, 252, 255),
        width=slash_w,
    )

    dot_r = max(scale, int(canvas_size * 0.052))
    dot_cx = cx + ring_r * 0.36
    dot_cy = cy + ring_r * 0.22
    draw.ellipse(
        [dot_cx - dot_r, dot_cy - dot_r, dot_cx + dot_r, dot_cy + dot_r],
        fill=(251, 146, 60, 255),
    )

    return img.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    icons_dir = root / "icons"
    icons_dir.mkdir(parents=True, exist_ok=True)

    for size in (16, 32, 48, 128):
        out_path = icons_dir / f"icon{size}.png"
        icon = draw_icon(size)
        icon.save(out_path, format="PNG", optimize=True)
        print(f"Generated {out_path.relative_to(root)} ({size}x{size})")


if __name__ == "__main__":
    main()
