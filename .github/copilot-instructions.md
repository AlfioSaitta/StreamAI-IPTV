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
- Native Android player using ExoPlayer for optimal performance

## Tech Stack

- **Framework:** React 19, TypeScript, Vite
- **Desktop Runtime:** Electron (with custom HEVC codec support via BranchBit)
- **Mobile Runtime:** Capacitor 7 (Android)
- **Styling:** Tailwind CSS (dark theme by default)
- **Video Player:** 
  - Desktop/Web: Video.js with custom OSD and interactive timeline
  - Android: Capacitor Video Player (ExoPlayer native)
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
npm run dist:linux       # Build Linux package (.tar.gz)
```

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
2. **Android Player:** HTML5 `<video>` has poor IPTV performance on Android. Use native player via `nativeVideoPlayer.ts` when `platformService.isNative` is true.
3. **Mixed Content:** App must play HTTP (insecure) streams even in secure context. Configured in `electron/main.js` and `android/app/src/main/AndroidManifest.xml` (usesCleartextTraffic).
4. **Electron Build:** Ensure `services` folder is included in `package.json` → `build.files` so `advertisingService.js` is available in production ASAR build.
5. **Xtream Live group order:** Do NOT sort `live` categories alphabetically in `services/xtream.ts → processContent()`. Users expect the server-defined order. Alphabetical sorting applies only to `movie`/`series`.
6. **AI hint dismissal:** `AiUnavailableHint` in `App.tsx` uses two state layers — `aiHintSessionDismissed` (in-memory, resets on profile change) and `ProfilePreferences.hideAiUnavailableHint` (persistent, toggled by "Non mostrare più" checkbox). Preserve both when editing.
7. **M3U profiles:** When `Profile.playlistUrl` is set, `App.tsx` must load and parse the playlist via `parseM3UAsync` (worker for >256 kB) on profile activation before rendering the catalog.
8. **Per-type Continue Watching:** `ChannelList` filters the "Continue Watching" rail using `ProfilePreferences.continueWatchingMoviesEnabled` (default `false`) and `continueWatchingSeriesEnabled` (default `true`). Keep both toggles wired through `App.tsx` and `ProfileSettings.tsx`.

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
