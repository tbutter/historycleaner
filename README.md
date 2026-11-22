# History Cleaner — Chrome Extension

A lightweight, privacy-first **Manifest V3** Chrome extension that removes browsing history entries whose **full URL** matches your list of regular expressions—either on a configurable periodic background schedule (`chrome.alarms`) or via an on-demand manual trigger.

> [!NOTE]
> **Not for hiding activity from other users on a shared computer:** Removing entries via `chrome.history` is intended for keeping your history tidy, *not* for concealing visits from other people with access to your browser or device. Chrome's address bar (Omnibox) autocomplete caches, shortcuts, bookmarks, open tabs, or synced search suggestions may still surface visited URLs or domains for some time after history entries are deleted. Use Chrome's **Incognito mode** or separate OS user accounts when sharing a computer.

## Key Features

- **Full-URL Regular Expression Matching:** Standard JavaScript `RegExp` rules evaluated strictly against full URLs (page titles are ignored), with per-rule case-insensitivity (`i`), enable/disable switches, and optional notes.
- **Scheduled + Manual Cleanup:** Automatic periodic sweeps via `chrome.alarms` (every 5m, 15m, 30m, 1h, 6h, 24h, or any custom interval ≥ 1 minute), optional browser-startup sweep, and one-click **Clean Now** from the toolbar popup or options page.
- **Complete History Pagination:** Paginates through `chrome.history.search` from `startTime: 0` rather than stopping at Chrome's default 100-item / 24-hour query window.
- **Safety Guards & Dry-Run Preview:** Rejects empty/whitespace patterns, warns when a rule is overly broad (e.g. `.*`), includes a live URL rule tester, and provides an in-memory **Preview History Matches** dry run before deleting anything.
- **Local-Only Storage & Portability:** Stores rules and schedule settings exclusively in `chrome.storage.local` with **JSON** and **plain-text (`.txt`, one regex per line)** import and export (merge or replace).
- **Zero Deleted-URL Logging:** Aggregate telemetry stores only timestamps and item counts—never visited or deleted URLs.

## Installation (Load Unpacked — Zero Build Step)

1. Open Google Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** in the top-right corner.
3. Click **Load unpacked** and select the root directory of this repository (`historycleaner/`).
4. Pin **History Cleaner** in your Chrome toolbar to access quick cleanup, match previews, and the full Rules & Schedule manager.

## Example Regular Expressions

| Goal | Regular Expression |
| :--- | :--- |
| Local development servers (`localhost` / `127.0.0.1` on any port) | `^https?://(localhost\|127\.0\.0\.1)(:[0-9]+)?/` |
| Specific domain and all subdomains | `^https?://([^/]+\.)?example\.com/` |
| URLs containing tracking parameters (`utm_source`, `fbclid`, `gclid`) | `[?&](utm_source\|fbclid\|gclid)=` |
| OAuth / temporary token callback URLs | `[?&#](access_token\|id_token\|code)=` |

## Plain-Text (`.txt`) Import/Export Format

Plain-text files list one regular expression per line. Blank lines are ignored, and `#` comment lines immediately preceding a regex are imported as that rule's note:

```text
# Localhost dev servers
^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?/

# Temporary preview deployments
^https://[a-z0-9-]+--my-app\.netlify\.app/
```

## Development & Verification

Requires Node.js 20+ (uses the built-in `node:test` runner with zero external npm dependencies):

```bash
# Run unit & integration test suite
npm test

# Regenerate 16/32/48/128 PNG icons (requires Python 3 + Pillow)
npm run icons

# Build Chrome Web Store zip archive in dist/historycleaner-v1.0.0.zip
npm run package

# Generate Chrome Web Store 1280x800 screenshots & 440x280 promo tile
npm run screenshots
```

## Permissions Rationale

- `history` — Required to search history URLs (`chrome.history.search`) and remove matching entries (`chrome.history.deleteUrl`).
- `storage` — Required to persist regex rules, schedule configuration, and aggregate counts in `chrome.storage.local`.
- `alarms` — Required to wake the Manifest V3 service worker for scheduled periodic cleanups (`chrome.alarms`).
- *No `tabs` or `<all_urls>` host permissions are requested.*

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
