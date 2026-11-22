#!/usr/bin/env python3
"""
Generates Chrome Web Store screenshots (1280x800, 24-bit RGB PNG, no alpha)
and Small Promo Tile (440x280, 24-bit RGB PNG, no alpha) from live Chromium renders
of the unpacked History Cleaner extension.
"""

import base64
import io
import tempfile
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT_DIR / "dist" / "store-screenshots"


def to_data_uri(png_bytes: bytes) -> str:
    b64 = base64.b64encode(png_bytes).decode("ascii")
    return f"data:image/png;base64,{b64}"


def save_rgb_png(png_bytes: bytes, dest: Path, expected_size: tuple[int, int]) -> None:
    with Image.open(io.BytesIO(png_bytes)) as im:
        rgb = im.convert("RGB")
        if rgb.size != expected_size:
            rgb = rgb.resize(expected_size, Image.Resampling.LANCZOS)
        assert rgb.mode == "RGB", f"Expected 24-bit RGB (no alpha), got {rgb.mode}"
        assert rgb.size == expected_size, f"Expected {expected_size}, got {rgb.size}"
        rgb.save(dest, format="PNG", optimize=True)
    print(f"Saved {dest} ({expected_size[0]}x{expected_size[1]}, 24-bit RGB PNG)")


def build_framed_slide_html(
    *,
    headline: str,
    subheadline: str,
    screenshot_uri: str,
    dark: bool = False,
    url_bar_text: str = "chrome-extension://history-cleaner/options.html",
) -> str:
    bg = "#0c131d" if dark else "#eef3f8"
    banner_title = "#f1f5f9" if dark else "#0f1c2e"
    banner_sub = "#94a3b8" if dark else "#475569"
    win_bg = "#161f2c" if dark else "#ffffff"
    win_bar = "#1e293b" if dark else "#f1f5f9"
    win_border = "#2d3b4e" if dark else "#cbd5e1"
    url_bg = "#0f172a" if dark else "#ffffff"
    url_text = "#94a3b8" if dark else "#64748b"
    shadow = (
        "0 24px 60px rgba(0, 0, 0, 0.55)"
        if dark
        else "0 22px 52px rgba(15, 28, 46, 0.14)"
    )

    return f"""<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  html, body {{
    width: 1280px;
    height: 800px;
    overflow: hidden;
    background: {bg};
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }}
  .canvas {{
    width: 1280px;
    height: 800px;
    padding: 34px 52px 0;
    display: flex;
    flex-direction: column;
    align-items: center;
  }}
  .header {{
    text-align: center;
    margin-bottom: 24px;
    max-width: 980px;
  }}
  .header h1 {{
    font-size: 29px;
    font-weight: 750;
    letter-spacing: -0.025em;
    color: {banner_title};
    line-height: 1.2;
  }}
  .header p {{
    margin-top: 7px;
    font-size: 16px;
    color: {banner_sub};
    line-height: 1.4;
  }}
  .browser-frame {{
    width: 1120px;
    flex: 1;
    background: {win_bg};
    border: 1px solid {win_border};
    border-bottom: none;
    border-radius: 14px 14px 0 0;
    box-shadow: {shadow};
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }}
  .browser-bar {{
    height: 40px;
    background: {win_bar};
    border-bottom: 1px solid {win_border};
    display: flex;
    align-items: center;
    padding: 0 16px;
    gap: 14px;
    flex-shrink: 0;
  }}
  .dots {{
    display: flex;
    gap: 7px;
  }}
  .dot {{
    width: 11px;
    height: 11px;
    border-radius: 50%;
  }}
  .dot.r {{ background: #ef4444; opacity: 0.75; }}
  .dot.y {{ background: #f59e0b; opacity: 0.75; }}
  .dot.g {{ background: #10b981; opacity: 0.75; }}
  .address-bar {{
    flex: 1;
    height: 25px;
    background: {url_bg};
    border: 1px solid {win_border};
    border-radius: 6px;
    display: flex;
    align-items: center;
    padding: 0 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    color: {url_text};
  }}
  .shot-wrap {{
    flex: 1;
    overflow: hidden;
    background: {win_bg};
  }}
  .shot-wrap img {{
    width: 100%;
    display: block;
  }}
</style>
</head>
<body>
  <div class="canvas">
    <div class="header">
      <h1>{headline}</h1>
      <p>{subheadline}</p>
    </div>
    <div class="browser-frame">
      <div class="browser-bar">
        <div class="dots">
          <span class="dot r"></span>
          <span class="dot y"></span>
          <span class="dot g"></span>
        </div>
        <div class="address-bar">{url_bar_text}</div>
      </div>
      <div class="shot-wrap">
        <img src="{screenshot_uri}" alt="">
      </div>
    </div>
  </div>
</body>
</html>"""


def build_popup_showcase_html(
    *,
    icon_uri: str,
    popup_preview_uri: str,
    popup_cleaned_uri: str,
) -> str:
    return f"""<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  html, body {{
    width: 1280px;
    height: 800px;
    overflow: hidden;
    background: #eef3f8;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }}
  .canvas {{
    width: 1280px;
    height: 800px;
    padding: 36px 56px 40px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }}
  .header {{
    text-align: center;
    margin-bottom: 28px;
  }}
  .header h1 {{
    font-size: 29px;
    font-weight: 750;
    letter-spacing: -0.025em;
    color: #0f1c2e;
  }}
  .header p {{
    margin-top: 7px;
    font-size: 16px;
    color: #475569;
  }}
  .columns {{
    width: 100%;
    max-width: 1040px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 48px;
    align-items: start;
    justify-items: center;
  }}
  .step-col {{
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    width: 100%;
  }}
  .step-caption {{
    display: flex;
    align-items: center;
    gap: 9px;
    font-size: 14px;
    font-weight: 650;
    color: #1e293b;
  }}
  .step-num {{
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: #11699c;
    color: #ffffff;
    font-size: 12.5px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }}
  .toolbar-strip {{
    width: 416px;
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    border-radius: 10px;
    padding: 7px 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    box-shadow: 0 2px 6px rgba(15, 28, 46, 0.06);
  }}
  .fake-url {{
    background: #ffffff;
    border: 1px solid #dce4ee;
    border-radius: 999px;
    padding: 4px 14px;
    font-size: 12px;
    color: #64748b;
    width: 320px;
  }}
  .ext-pin {{
    width: 30px;
    height: 30px;
    border-radius: 7px;
    background: #e0f2fe;
    border: 1px solid #7dd3fc;
    display: flex;
    align-items: center;
    justify-content: center;
  }}
  .ext-pin img {{
    width: 20px;
    height: 20px;
  }}
  .popup-card {{
    width: 396px;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid #cbd5e1;
    box-shadow: 0 20px 44px rgba(15, 28, 46, 0.16);
    background: #f5f7fa;
  }}
  .popup-card img {{
    width: 100%;
    display: block;
  }}
</style>
</head>
<body>
  <div class="canvas">
    <div class="header">
      <h1>One-Click Toolbar Cleanup &amp; Dry-Run Preview</h1>
      <p>Inspect matching history entries before deleting, trigger instant sweeps, or quick-add regex rules from any tab.</p>
    </div>
    <div class="columns">
      <div class="step-col">
        <div class="step-caption">
          <span class="step-num">1</span>
          <span>Preview matching history URLs before deleting</span>
        </div>
        <div class="toolbar-strip">
          <div class="fake-url">chrome://history</div>
          <div class="ext-pin"><img src="{icon_uri}" alt=""></div>
        </div>
        <div class="popup-card">
          <img src="{popup_preview_uri}" alt="">
        </div>
      </div>

      <div class="step-col">
        <div class="step-caption">
          <span class="step-num">2</span>
          <span>Clean instantly &amp; quick-add new URL patterns</span>
        </div>
        <div class="toolbar-strip">
          <div class="fake-url">chrome://history</div>
          <div class="ext-pin"><img src="{icon_uri}" alt=""></div>
        </div>
        <div class="popup-card">
          <img src="{popup_cleaned_uri}" alt="">
        </div>
      </div>
    </div>
  </div>
</body>
</html>"""


def build_promo_tile_html(*, icon_uri: str) -> str:
    return rf"""<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  html, body {{
    width: 440px;
    height: 280px;
    overflow: hidden;
    background: #13293d;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
    color: #f8fafc;
  }}
  .tile {{
    width: 440px;
    height: 280px;
    padding: 28px 30px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    border: 1px solid #23496d;
    background: radial-gradient(circle at 88% 18%, #1b3b5a 0%, #102336 72%);
  }}
  .top {{
    display: flex;
    align-items: center;
    gap: 14px;
  }}
  .top img {{
    width: 54px;
    height: 54px;
  }}
  .brand {{
    font-size: 23px;
    font-weight: 750;
    letter-spacing: -0.02em;
    line-height: 1.15;
  }}
  .tag {{
    font-size: 13px;
    color: #7dd3fc;
    margin-top: 3px;
    font-weight: 500;
  }}
  .regex-demo {{
    background: rgba(15, 23, 42, 0.65);
    border: 1px solid #2b547e;
    border-radius: 8px;
    padding: 10px 13px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12.5px;
    color: #e2e8f0;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }}
  .regex-demo .comment {{
    color: #94a3b8;
    font-size: 11px;
  }}
  .regex-demo .accent {{
    color: #38bdf8;
  }}
  .footer {{
    display: flex;
    gap: 14px;
    font-size: 12px;
    color: #cbd5e1;
    font-weight: 500;
  }}
</style>
</head>
<body>
  <div class="tile">
    <div class="top">
      <img src="{icon_uri}" alt="">
      <div>
        <div class="brand">History Cleaner</div>
        <div class="tag">Regex URL Eraser for Chrome</div>
      </div>
    </div>
    <div class="regex-demo">
      <span class="comment"># Scheduled &amp; on-demand full-URL matching</span>
      <span><span class="accent">/^https?:\/\/</span>(localhost|staging\.app)<span class="accent">/i</span></span>
    </div>
    <div class="footer">
      <span>• Periodic Alarms</span>
      <span>• Dry-Run Preview</span>
      <span>• 100% Local</span>
    </div>
  </div>
</body>
</html>"""


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    icon_bytes = (ROOT_DIR / "icons" / "icon128.png").read_bytes()
    icon_uri = to_data_uri(icon_bytes)

    with tempfile.TemporaryDirectory() as user_data_dir:
        with sync_playwright() as p:
            context = p.chromium.launch_persistent_context(
                user_data_dir,
                headless=False,
                device_scale_factor=2,
                args=[
                    "--headless=new",
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    f"--disable-extensions-except={ROOT_DIR}",
                    f"--load-extension={ROOT_DIR}",
                ],
            )

            sw = (
                context.service_workers[0]
                if context.service_workers
                else context.wait_for_event("serviceworker", timeout=10000)
            )
            ext_id = sw.url.split("/")[2]

            # Open Options page and seed realistic rules + history entries via chrome.history.addUrl
            opt = context.new_page()
            opt.set_viewport_size({"width": 960, "height": 900})
            opt.emulate_media(color_scheme="light")
            opt.goto(f"chrome-extension://{ext_id}/src/options/options.html", wait_until="networkidle")

            # Seed realistic browsing history entries (matching & non-matching)
            sample_urls = [
                # Non-matching normal browsing history
                "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions",
                "https://en.wikipedia.org/wiki/Regular_expression",
                "https://github.com/chromium/chromium",
                "https://web.dev/articles/ManifestV3",
                "https://news.ycombinator.com/",
                "https://nodejs.org/api/test.html",
                # Matching URLs we will clean in initial run to populate realistic telemetry
                "http://localhost:8080/internal/metrics",
                "http://127.0.0.1:4000/graphql-playground",
                "https://blog.example.org/post?utm_source=weekly&fbclid=IwAR9x",
            ]
            opt.evaluate(
                """async (urls) => {
                  for (const url of urls) {
                    await chrome.history.addUrl({ url });
                  }
                }""",
                sample_urls,
            )

            # Add 4 clear, practical regex rules via the Options UI
            rules_to_add = [
                (r"^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?/", "Localhost & loopback dev servers"),
                (r"[?&](utm_source|fbclid|gclid)=", "Marketing & ad tracking query URLs"),
                (r"^https?://([^/]+\.)?staging\.acme\.dev/", "Temporary staging deployment previews"),
                (r"[?&#](access_token|id_token|session_key)=", "OAuth callback & ephemeral token URLs"),
            ]
            for pattern, note in rules_to_add:
                opt.fill("#new-pattern-input", pattern)
                opt.fill("#new-note-input", note)
                opt.click("#add-rule-btn")

            # Run one initial Clean Now so telemetry shows realistic Last Cleanup + Lifetime Removed!
            opt.click("#opt-clean-now-btn")
            opt.wait_for_function(
                "() => document.querySelector('#opt-stat-total-deleted').textContent === '3'"
            )
            # Hide top banner for clean Shot 1
            opt.evaluate("document.querySelector('#global-banner').hidden = true")

            # Now seed 3 fresh matching URLs for Dry-Run Preview & Popup shots!
            fresh_matching_urls = [
                "http://localhost:5173/admin/debug?session_key=tmp_94f2a",
                "https://pr-418.staging.acme.dev/checkout/preview",
                "https://store.example.com/deals?utm_source=promo_email&gclid=EAIaIQ",
            ]
            opt.evaluate(
                """async (urls) => {
                  for (const url of urls) {
                    await chrome.history.addUrl({ url });
                  }
                }""",
                fresh_matching_urls,
            )

            # Hide native scrollbars during store capture for clean studio framing
            opt.add_style_tag(content="::-webkit-scrollbar { display: none !important; }")

            # --- SHOT 1: Rules Manager + Live URL Rule Tester (Light Mode) ---
            opt.fill(
                "#test-url-input",
                "http://localhost:5173/admin/debug?session_key=tmp_94f2a",
            )
            opt.set_viewport_size({"width": 1060, "height": 1400})
            rules_y = opt.evaluate(
                "() => document.querySelector('[aria-labelledby=\"rules-heading\"]').offsetTop - 18"
            )
            opt.set_viewport_size({"width": 1060, "height": 640})
            opt.evaluate(f"window.scrollTo(0, {rules_y})")
            raw_shot_1 = opt.screenshot()

            # --- SHOT 3: Periodic Schedule + Local JSON / Plain-Text Import-Export ---
            opt.fill("#test-url-input", "")
            opt.evaluate("document.querySelector('#test-url-input').dispatchEvent(new Event('input'))")
            opt.evaluate("document.querySelector('#schedule-startup-toggle').click()")
            opt.fill(
                "#import-textarea",
                "# Internal preview environments\n"
                "^https://[a-z0-9-]+--dashboard\\.netlify\\.app/\n"
                "# Ephemeral password-reset links\n"
                "^https://auth\\.example\\.com/reset-password\\?token=",
            )
            opt.set_viewport_size({"width": 1060, "height": 1500})
            schedule_y = opt.evaluate(
                "() => document.querySelector('[aria-labelledby=\"schedule-heading\"]').offsetTop - 16"
            )
            opt.set_viewport_size({"width": 1060, "height": 640})
            opt.evaluate(f"window.scrollTo(0, {schedule_y})")
            raw_shot_3 = opt.screenshot()

            # --- SHOT 4: Dark Mode + Dry-Run History Match Preview ---
            opt.emulate_media(color_scheme="dark")
            opt.set_viewport_size({"width": 1060, "height": 612})
            opt.evaluate("window.scrollTo(0, 0)")
            opt.evaluate("document.querySelector('#global-banner').hidden = true")
            opt.click("#opt-preview-btn")
            opt.wait_for_selector("#opt-preview-panel:not([hidden])")
            raw_shot_4 = opt.screenshot()

            # --- SHOT 2: Toolbar Popup (Preview Matches + Cleaned Confirmation) ---
            pop = context.new_page()
            pop.emulate_media(color_scheme="light")
            pop.set_viewport_size({"width": 380, "height": 530})
            pop.goto(f"chrome-extension://{ext_id}/src/popup/popup.html", wait_until="networkidle")
            pop.click("#preview-btn")
            pop.wait_for_selector("#popup-preview-section:not([hidden])")
            # Resize height tightly to body scrollHeight
            h1 = pop.evaluate("() => document.body.scrollHeight")
            pop.set_viewport_size({"width": 380, "height": h1})
            raw_popup_preview = pop.screenshot()

            # Now click Clean Now and pre-fill quick-add input to show quick-add in action
            pop.click("#clean-now-btn")
            pop.wait_for_function(
                "() => document.querySelector('#popup-feedback').textContent.includes('Removed 3 matching URLs')"
            )
            pop.fill("#quick-pattern-input", r"^https?://temp\.example\.org/")
            pop.evaluate("document.querySelector('#quick-pattern-input').dispatchEvent(new Event('input'))")
            h2 = pop.evaluate("() => document.body.scrollHeight")
            pop.set_viewport_size({"width": 380, "height": h2})
            raw_popup_cleaned = pop.screenshot()

            # Render final 1280x800 (device_scale_factor=1 -> exact 1280x800) store slides!
            composer_ctx = p.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )
            comp = composer_ctx.new_page(
                viewport={"width": 1280, "height": 800},
                device_scale_factor=1,
            )

            # Slide 1
            comp.set_content(
                build_framed_slide_html(
                    headline="Erase Unwanted Browsing History with Regular Expressions",
                    subheadline="Define full-URL RegExp rules with instant syntax validation and a live URL tester.",
                    screenshot_uri=to_data_uri(raw_shot_1),
                    dark=False,
                ),
                wait_until="load",
            )
            save_rgb_png(
                comp.screenshot(),
                OUT_DIR / "01-rules-and-live-tester-1280x800.png",
                (1280, 800),
            )

            # Slide 2
            comp.set_content(
                build_popup_showcase_html(
                    icon_uri=icon_uri,
                    popup_preview_uri=to_data_uri(raw_popup_preview),
                    popup_cleaned_uri=to_data_uri(raw_popup_cleaned),
                ),
                wait_until="load",
            )
            save_rgb_png(
                comp.screenshot(),
                OUT_DIR / "02-popup-and-preview-1280x800.png",
                (1280, 800),
            )

            # Slide 3
            comp.set_content(
                build_framed_slide_html(
                    headline="Scheduled Automatic Sweeps & Portable Local Rules",
                    subheadline="Configure periodic background alarms and export or import rules as JSON or plain text (.txt).",
                    screenshot_uri=to_data_uri(raw_shot_3),
                    dark=False,
                ),
                wait_until="load",
            )
            save_rgb_png(
                comp.screenshot(),
                OUT_DIR / "03-schedule-and-import-export-1280x800.png",
                (1280, 800),
            )

            # Slide 4
            comp.set_content(
                build_framed_slide_html(
                    headline="Dry-Run Match Previews & Privacy-First Local Storage",
                    subheadline="Inspect matching history URLs before deleting. Zero visited or deleted URLs are ever logged.",
                    screenshot_uri=to_data_uri(raw_shot_4),
                    dark=True,
                ),
                wait_until="load",
            )
            save_rgb_png(
                comp.screenshot(),
                OUT_DIR / "04-dark-mode-dry-run-1280x800.png",
                (1280, 800),
            )

            # Bonus: Small Promo Tile (440x280, 24-bit RGB PNG)
            comp.set_viewport_size({"width": 440, "height": 280})
            comp.set_content(build_promo_tile_html(icon_uri=icon_uri), wait_until="load")
            save_rgb_png(
                comp.screenshot(),
                OUT_DIR / "promo-tile-440x280.png",
                (440, 280),
            )

            composer_ctx.close()
            context.close()


if __name__ == "__main__":
    main()
