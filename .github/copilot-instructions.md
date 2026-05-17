# GitHub Copilot Instructions for StreamAI IPTV

This file provides context and guidelines for GitHub Copilot coding agent when working on the StreamAI IPTV project.

## Project Overview

**StreamAI IPTV** is a next-generation IPTV player built with React 19, TypeScript, Electron, and Tailwind CSS. It features AI-powered recommendations using Google Gemini and supports cross-platform deployment (Linux, Windows, Android via Capacitor).

**Key Capabilities:**
- Live TV streaming, Movies (VOD), and Series with advanced playback features
- AI-powered content recommendations via Google Gemini
- Universal casting to Chromecast, DLNA/UPnP, and AirPlay devices
- Picture-in-Picture support (Desktop and Android)
- Full keyboard/remote control support for TV interfaces
- Native Android player using **AndroidX Media3** (1.10.1) for optimal performance

## Tech Stack

- **Framework:** React 19, TypeScript, Vite
- **Desktop Runtime:** Electron (with custom HEVC codec support via BranchBit)
- **Mobile Runtime:** Capacitor 7 (Android)
- **Styling:** Tailwind CSS (dark theme by default)
- **Video Player:** 
  - Desktop/Web: Video.js with custom OSD and interactive timeline
  - Android: Capacitor Video Player (native player on **AndroidX Media3
    1.10.1** — `androidx.media3:media3-exoplayer:1.10.1`, pin 2026-05-15;
    plugin vendored in `android/plugins/capacitor-video-player/`, see
    MED-1 in `docs/IMPROVEMENT_PLAN.md` §4-bis)
- **AI:** Google Gemini API (@google/genai)
- **Networking:** mDNS (Bonjour), SSDP, DIAL for device discovery and advertising
- **Icons:** Lucide React

## Repository Structure

```
streamai-iptv/
├── components/          # React UI components
│   ├── VideoPlayerNew.tsx     # Unified player (Video.js + Native + OSD)
│   ├── AIRecommender.tsx      # AI assistant interface
│   ├── ChannelList.tsx        # Virtualized channel list (react-window)
│   ├── CastDevicePicker.tsx   # Cast device selection UI
│   ├── OnboardingWizard.tsx   # 3-step profile creation wizard (identity → source → prefs)
│   └── player/
│       └── StreamDiagnostics.tsx  # Live buffer health + recent errors panel
├── services/           # Business logic (Singleton pattern)
│   ├── platformService.ts     # Platform abstraction (Electron/Web/Capacitor)
│   ├── geminiService.ts       # Google Gemini AI integration
│   ├── xtream.ts              # Xtream Codes API client (preserves live group order)
│   ├── profileService.ts      # Profile CRUD + DEFAULT_PREFERENCES
│   ├── parser.ts              # M3U parser + parseM3UAsync (worker for >256 kB)
│   ├── deviceDiscovery.ts     # Network scanning for Cast/DLNA devices
│   └── advertisingService.js  # (Electron Main) mDNS/SSDP advertising
├── scripts/            # Build automation scripts
│   └── patch-ffmpeg.js        # HEVC codec patching for Electron
├── android/            # Native Android project (Gradle)
├── main.js             # Electron entry point
├── App.tsx             # Main React component (also: AiUnavailableHint banner)
└── AGENTS.md           # Detailed technical documentation for AI agents
```

## Build, Test, and Development

### Prerequisites
- Node.js v18+
- npm v9+
- For Android: JDK 17+, Android SDK API level 22+

### Development Commands
```bash
npm install              # Install dependencies (includes HEVC codec patch)
npm run dev              # Start Electron in development mode
npm run build            # Build with Vite
npm run version:sync     # Propagate /.version → package.json + android gradle
npm run version:full     # Print effective build version (base[_<sha7>])
npm run dist:linux       # Build native Linux package for the host distro
                         # (auto-detect via /etc/os-release)
npm run dist:linux:opensuse   # …or pick a specific distro target:
npm run dist:linux:fedora     #   opensuse / fedora / rhel / debian /
npm run dist:linux:rhel       #   ubuntu / arch — each produces a
npm run dist:linux:debian     #   package with that distro's native
npm run dist:linux:ubuntu     #   dependency names (build/depends/<distro>.json)
npm run dist:linux:arch       #   tagged as streamai-${ver}-<distro>.${arch}.<ext>
```

### Release & Signing Commands
```bash
npm run gpg:setup        # one-time: generate maintainer Ed25519 key
                         # + AES-256 encrypted backup of primary+subkey
npm run gpg:upload       # upload GPG_PRIVATE_KEY / GPG_PASSPHRASE /
                         # GPG_KEY_ID as Actions secrets via `gh` CLI
npm run repo:publish     # assemble public-repo/ for GitHub Pages
```

A `git tag v*` push triggers `.github/workflows/linux-release.yml` which:
- builds the 6 per-distro packages (no AppImage/tar.xz in CI)
- signs them (debsigs for .deb, rpm --addsign for .rpm, gpg detach-sign
  for .pkg.tar.zst + SHA256SUMS) — `gpg-agent` has the passphrase
  pre-cached via `gpg-preset-passphrase` so signing is fully headless
- verifies every signature strictly (rpm uses a dedicated rpmdb via
  `--dbpath`; deb is verified by reconstructing the signed blob in the
  *actual* `ar t` member order)
- emits SLSA build provenance, publishes a GitHub Release, and deploys
  the APT/RPM/Arch repos to GitHub Pages via the **official Pages API**
  (`actions/configure-pages` + `actions/upload-pages-artifact` +
  `actions/deploy-pages`) — no `git push`, no pack-size limits. The
  `public-repo/` tree is seeded from an `actions/cache` entry
  (`pages-history-v1-*`); if the cache is evicted the seed falls back
  to `gh release download` of every previously published `.deb`/`.rpm`/
  `.pkg.tar.zst` (Release assets are permanent storage). The
  `gh-pages` branch is no longer used.
- reuses 4 caches (Electron, electron-builder, APT toolchain, Docker
  images electronuserland/builder + archlinux:latest) ⇒ cold ~14 min,
  warm ~5 min

### Android Commands
```bash
npm run android:sync     # Sync web files to Android project
npm run android:build    # Build APK (debug)
npm run android:run      # Build and run on connected device
```

### Important Notes
- The `postinstall` script runs `patch-ffmpeg.js` automatically to add HEVC codec support
- Electron uses a custom FFmpeg build from BranchBit for H.265/HEVC playback
- Android requires `usesCleartextTraffic="true"` in manifest for HTTP streams

## Coding Standards

### TypeScript & React
- **Strict Typing:** Always use interfaces from `types.ts`. Avoid `any` unless absolutely necessary.
- **Performance Optimization:**
  - Use `React.memo` for list components
  - Use `useCallback` for functions passed as props
  - Use `react-window` for lists with 50+ items
- **Custom Hooks:** Prefer custom hooks for reusable logic (e.g., `useCastSession`)

### Cross-Platform Development
- **Never** call platform-specific APIs (e.g., `window.electronAPI`, `CapacitorPlugins`) directly in UI components
- **Always** use `platformService` to check environment (`isElectron`, `isNative`, `isWeb`)
- **Android:** Handle physical "Back" button in `App.tsx` via `App.addListener('backButton', ...)`
- **Electron Main Process:** Files run in main process (e.g., `advertisingService.js`) must be CommonJS JavaScript (`require`), not TypeScript

### Styling with Tailwind
- Default dark theme: Background `#141414`, Text `gray-100/gray-300`
- Use `tv-focus` class for keyboard/remote-navigable elements
- Mobile-first responsive design with `md:` and `lg:` breakpoints

### AI Integration
- Include context in Gemini requests (time, history, stream type)
- Responses should be structured JSON for UI rendering
- Implement caching for responses to save tokens and reduce latency

## Critical Features (Non-Negotiable)

These features define StreamAI's identity and must be preserved:

### 1. Picture-in-Picture (PiP)
- Users must be able to watch streams while browsing channels or using other apps
- Desktop: Uses `document.pictureInPictureElement` API
- Android: Native support via `capacitor-video-player`
- Keyboard shortcut: `P` key

### 2. Casting & Device Discovery
- Seamless transmission to Chromecast and DLNA/UPnP devices
- Full subnet (/24) scanning in `deviceDiscovery.ts`
- App advertises itself as AirPlay/DIAL receiver via `advertisingService.js` (Electron only)
- Discovery must run in background without blocking UI

### 3. Keyboard Shortcuts & Remote Control
- 100% controllable without mouse/touch (TV remote/keyboard friendly)
- Standard mappings:
  - `Space` / `Enter` / `P`: Play/Pause
  - `←` / `→`: Seek backward/forward (±10s)
  - `↑` / `↓`: Volume up/down (±10%)
  - `M`: Mute/Unmute
  - `F`: Fullscreen toggle
  - `C`: Cast menu
  - `L`: Channel list (Live) or episode list (Series)
  - `Esc`: Back/Close menu

### 4. Unified Interface
- "Write Once, Run Everywhere" philosophy
- Consistent visual appearance across Linux, Windows, and Android
- **OSD (On-Screen Display):** Mandatory visual feedback for all user actions
- **Timeline:** Must show tooltip on hover and position preview (ghost bar)
- Maintain `tv-focus` class for spatial navigation

## Important Gotchas

1. **HEVC Codec:** Electron uses custom FFmpeg build via `scripts/patch-ffmpeg.js`. Modify with caution.
2. **Android Player:** HTML5 `<video>` has poor IPTV performance on Android. Use native player via `nativeVideoPlayer.ts` when `platformService.isNative` is true. The native player is now backed by **AndroidX Media3 1.10.1** (`androidx.media3.exoplayer.ExoPlayer` + `androidx.media3.session.MediaSession` + `androidx.media3.cast.CastPlayer`) with `setEnableDecoderFallback(true)`, HDR tunneling, HLS chunkless preparation and IPTV-friendly buffer tuning.
3. **Android player plugin (vendor):** `capacitor-video-player` is vendored in `android/plugins/capacitor-video-player/` to detach from the orphan upstream. `package.json` uses `"capacitor-video-player": "file:android/plugins/capacitor-video-player"`. Apply patches and Media3 bumps there; `node_modules/capacitor-video-player` no longer exists as a GitHub package. A CI guard `scripts/check-media3-migration.mjs` (run via `npm run check`) fails the build if `com.google.android.exoplayer2.*` references creep back in.
4. **Mixed Content:** App must play HTTP (insecure) streams even in secure context. Configured in `electron/main.js` and `android/app/src/main/AndroidManifest.xml` (usesCleartextTraffic).
5. **Electron Build:** Ensure `services` folder is included in `package.json` → `build.files` so `advertisingService.js` is available in production ASAR build.
6. **Xtream Live group order:** Do NOT sort `live` categories alphabetically in `services/xtream.ts → processContent()`. Users expect the server-defined order. Alphabetical sorting applies only to `movie`/`series`.
7. **AI hint dismissal:** `AiUnavailableHint` in `App.tsx` uses two state layers — `aiHintSessionDismissed` (in-memory, resets on profile change) and `ProfilePreferences.hideAiUnavailableHint` (persistent, toggled by "Non mostrare più" checkbox). Preserve both when editing.
8. **M3U profiles:** When `Profile.playlistUrl` is set, `App.tsx` must load and parse the playlist via `parseM3UAsync` (worker for >256 kB) on profile activation before rendering the catalog.
9. **Per-type Continue Watching:** `ChannelList` filters the "Continue Watching" rail using `ProfilePreferences.continueWatchingMoviesEnabled` (default `false`) and `continueWatchingSeriesEnabled` (default `true`). Keep both toggles wired through `App.tsx` and `ProfileSettings.tsx`.
10. **CI signing (`.deb` / `.rpm`):** Ubuntu 24.04 noble has **dropped `dpkg-sig`** — `.deb` packages are now signed with `debsigs --sign=origin` (embeds an OpenPGP detached sig as the `_gpgorigin` ar member). The CI verification step must NOT assume a canonical `ar` member order: `debsigs` signs the bytes in the **actual** archive order, which depends on control/data compression. Always rebuild the signed blob from `ar t` output. For `.rpm`, import the maintainer pubkey into a **dedicated rpmdb** via `rpm --dbpath` + `--initdb` + `--import` before `rpm --checksig`; `sudo rpm --import` writes to root's rpmdb, invisible to the runner user.
11. **CI GPG headless:** `scripts/import-gpg-key.sh` enables `allow-preset-passphrase` in `gpg-agent.conf` and calls `gpg-preset-passphrase` for every keygrip (primary + subkeys) so `debsigs`/`rpm --addsign`/`gpg --detach-sign` never need to open `/dev/tty`. Both jobs (`build`, `pages`) must export `GPG_PASSPHRASE` to that step.
12. **`gh-pages` deploy = Pages API + cache + Release fallback:** The `pages` job deploys via the **official GitHub Pages API** (`actions/configure-pages@v5` → `actions/upload-pages-artifact@v3` → `actions/deploy-pages@v4`, environment `github-pages`). This bypasses `git push` entirely, sidestepping the HTTP 500 we hit with `peaceiris/actions-gh-pages` once the accumulated repo grew too large for a single pack. Historical package retention: an `actions/cache` entry keyed `pages-history-v1-*` (seeded into `public-repo/` before `publish-repo.sh` runs) is the primary store; if the cache is evicted (7 days unused) the seed step falls back to `gh release download` of every `.deb`/`.rpm`/`.pkg.tar.zst`/`.sig`/`.asc` asset from past GitHub Releases — Release assets are permanent storage and have no push-size limit. The `gh-pages` branch is no longer used (even with `force_orphan: true` the push kept hitting HTTP 500 on the assembled repo size). **Required repo setting:** *Settings → Pages → Source: "GitHub Actions"* (not "Deploy from a branch"). Never reintroduce a `gh-pages` push step.
13. **Version is read from `/.version`:** The base version (semver `x.y.z`) lives in the `.version` file at the repo root — single source of truth. `scripts/sync-version.mjs` propagates it to `package.json` and `android/app/build.gradle` (both `versionName` and `versionCode = maj*10000 + min*100 + pat`). Never hand-edit `package.json` `"version"` — always bump `.version` then run `npm run version:sync`. In CI, `linux-release.yml` exports `COMMIT_SHA=${GITHUB_SHA::7}` and `build-linux.sh` forwards it to `make-distro-config.mjs --commit`, which embeds the SHA in the artefact filename. Final pattern: `streamai-iptv_${version}_${commit}_${distro}_${arch}.${ext}` in CI, `streamai-iptv_${version}_${distro}_${arch}.${ext}` locally. The CI cross-check + `publish-repo.sh` globs match on `*_${distro}_*` (underscore-separated), not `*-${distro}.*`.

## Additional Context

For detailed technical architecture, patterns, and conventions, refer to:
- **AGENTS.md**: Comprehensive guide for AI agents working on this project
- **README.md**: User-facing documentation and setup instructions
- **types.ts**: TypeScript interfaces and type definitions

## Working with Issues

When assigned to an issue:
1. Read the issue description carefully
2. Review related files mentioned in the issue
3. Check `AGENTS.md` for architectural guidance
4. Make minimal, focused changes
5. Ensure changes don't break keyboard navigation or casting functionality
6. Test on the target platform if possible (Electron for desktop, Android build for mobile)
7. Update documentation if adding new features or changing behavior

## Security Considerations

- Never commit API keys or secrets to the repository
- Gemini API key should be set via environment variable `VITE_GEMINI_API_KEY`
- Validate all user inputs, especially URLs and stream paths
- Sanitize data before rendering in UI to prevent XSS
- Be cautious with `eval()` or dynamic code execution
