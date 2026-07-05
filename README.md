# NTS Widget

A macOS menu bar widget for [NTS Radio](https://www.nts.live) — full-day schedule for both channels, live "on air" info, in-app streaming, and favorites, all in a small always-available desktop panel.

Unofficial fan project. Not affiliated with or endorsed by NTS Radio. Built against NTS's public (undocumented) schedule/live endpoints — see [Disclaimer](#disclaimer).

## Features

- **Full-day schedule** for both NTS 1 and NTS 2, auto-scrolled to the current show with past/upcoming context
- **Live "On Air" hero panel** — artwork, genre, location, description, live progress bar
- **In-app streaming** — play either channel directly from the widget, with a menu bar play/pause and media-key support
- **Favorites** — star a show, get notified when it's coming up next; dedicated Favorites tab
- **Notifications** on show changes and upcoming favorites (toggleable)
- **Sleep timer** (15/30/60/120/180 min)
- **Light / Dark / Auto** theme, with a customizable accent color
- **12/24-hour time format**
- **Menu bar now-playing text**, with the icon hidden while it's showing so it reads as a clean title
- Draggable, resizable window; optional "Pin to Desktop" mode that drops it behind other windows like a true desktop widget
- Launch at Login, Show in Dock, and other quality-of-life settings

## Screenshot

_Add a screenshot here — drag one into the repo and reference it, e.g. `docs/screenshot.png`._

## Installation

1. Download the latest `.dmg` from [Releases](../../releases)
2. Open it, drag **NTS Widget.app** to **Applications**
3. First launch: the app is unsigned (no paid Apple Developer certificate), so macOS Gatekeeper will block a normal double-click. Either:
   - Right-click the app in Applications → **Open** → **Open** again in the dialog, or
   - Run `xattr -d com.apple.quarantine "/Applications/NTS Widget.app"` in Terminal, then open normally
4. After that first approval, it opens normally every time.

The app lives in your menu bar (look for the icon near the clock). Click the tray icon for quick controls (play/pause per channel, Settings); click the widget itself to open the full schedule.

## Building from source

Requires Node.js and npm.

```bash
git clone <this-repo-url>
cd nts-widget
npm install
npm run build   # bundles renderer/app.jsx -> renderer/bundle.js
npm start       # launches the app via Electron for development
```

To produce a distributable `.dmg` + `.zip`:

```bash
npm run dist
```

Output goes to `dist/` (e.g. `dist/NTS Widget-1.0.0-arm64.dmg`). This repo is configured for Apple Silicon (`arm64`) only — edit the `"mac"."target"` `arch` arrays in `package.json` if you need an Intel build too.

## Settings

Open via the tray menu (**Settings...**) or the ⚙ tab in the widget itself:

| Setting | What it does |
|---|---|
| Appearance | Dark / Light / Auto (follows macOS's own appearance setting live) |
| Accent Color | Preset swatches or a custom color picker |
| Notifications | On/off for show-change and favorite "coming up" alerts |
| Default Channel on Launch | Which channel tab is active on startup |
| Time Format | 24H or 12H clock display |
| Auto-Resume Last Station | Automatically resumes whichever channel was last playing, on launch |
| Show Now Playing in Menu Bar | Show/hide the current show's title next to the tray icon |
| Pin to Desktop | Locks the window's position (no drag/resize) and drops it behind other windows, like a native desktop widget |
| Launch at Login | Starts the app automatically when you log in (only available in the packaged app — meaningless in dev mode, see below) |
| Show in Dock | Show/hide the app's Dock icon |

## Known limitations

- **Unsigned build**: no paid Apple Developer ID certificate was used, so Gatekeeper requires the one-time manual approval described above. If you have a Developer ID, you can codesign + notarize your own build via `electron-builder`'s `mac.identity` / notarization config.
- **Launch at Login only works in the packaged app.** In dev mode (`npm start`), Electron's `app.setLoginItemSettings` would register the generic `Electron.app` binary rather than this app, which is meaningless outside a real packaged build — the toggle is disabled until you're running the actual packaged `.app`.
- **"Show in Dock" toggle**: currently unreliable — flagged as a known issue, not yet resolved.
- The schedule/live data comes from NTS's own website's internal API endpoints, which are not publicly documented and could change or break without notice.

## Tech stack

- [Electron](https://www.electronjs.org/) 31 + React 18 (via `esbuild`, no bundler config beyond a single `esbuild` call)
- No backend — talks directly to `nts.live`'s own API from the renderer process
- Packaged with [electron-builder](https://www.electron.build/)

## Disclaimer

This is an independent, unofficial project and is not affiliated with, endorsed by, or sponsored by NTS Radio. All show data, artwork, and stream audio are the property of NTS and fetched live from their own public site/API at runtime — nothing is redistributed or cached beyond normal in-memory display. The app icon is an original design (not NTS's logo/wordmark) to avoid any trademark confusion.

## License

MIT — see [LICENSE](LICENSE).
