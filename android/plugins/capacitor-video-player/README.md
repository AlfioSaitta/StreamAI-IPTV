# capacitor-video-player (vendor fork StreamAI IPTV)

> **Fork in-tree** del plugin Capacitor [`@brylsherbert/capacitor-video-player`
> 7.0.32](https://github.com/phiamo/capacitor-video-player) vendorato sotto
> `android/plugins/capacitor-video-player/` come parte della migrazione
> **MED-1** (vedi `docs/IMPROVEMENT_PLAN.md` §4-bis).

## Rationale

1. **Upstream orfano.** Né `phiamo` né `harmonwood` hanno commit di sostanza
   da > 18 mesi; il pacchetto npm originale dipende ancora da
   `com.google.android.exoplayer:exoplayer-*:2.19.0`, **deprecata da marzo
   2024** (EOL, niente fix di sicurezza, niente supporto Android 15/16,
   niente nuove feature HDR/AV1 SW).
2. **Indipendenza CI.** Vendorando il plugin evitiamo dipendenze GitHub a
   runtime di `npm install`, e possiamo applicare patch idempotenti senza
   forkare un repo Git esterno.
3. **Compatibilità Media3.** Possiamo allineare il plugin a AndroidX Media3
   `1.10.1` (pin 2026-05-15) e abilitare le feature mancanti in upstream
   (decoder fallback, tunneling HDR, HLS chunkless preparation, buffer
   tuning IPTV-friendly).

## Versioni pinnate

| Componente | Versione | File |
| ---------- | -------- | ---- |
| AndroidX Media3 | `1.10.1` | `android/variables.gradle` → `media3Version` |
| Google Cast SDK | `21.5.0` | `android/variables.gradle` → `playServicesCastVersion` |

> **Politica di bump.** È consentito bumpare solo a **patch `1.10.x`**
> senza ri-eseguire la smoke matrix (`docs/IMPROVEMENT_PLAN.md`
> §4-bis.6 Step 7). Salto di minor (`1.11+`) richiede nuovo passaggio di
> smoke completo.

## Patch applicate sopra upstream

Diff sintetico rispetto a `@brylsherbert/capacitor-video-player@7.0.32`:

### `android/build.gradle`

- Rimosse 8 `implementation com.google.android.exoplayer:*:2.19.0`.
- Sostituite con 10 `implementation androidx.media3:*:1.10.1` (common,
  datasource, extractor, exoplayer, exoplayer-hls, exoplayer-dash,
  exoplayer-smoothstreaming, ui, session, cast) +
  `com.google.android.gms:play-services-cast-framework:21.5.0`.
- `compileSdk 36`, `minSdk 24`, `targetSdk 36`, `buildFeatures.buildConfig
  true`.

### `android/src/main/java/.../FullscreenExoPlayerFragment.java`

- **Import:** rinominati ~30 simboli da `com.google.android.exoplayer2.*`
  a `androidx.media3.*` (mapping completo in
  `docs/IMPROVEMENT_PLAN.md` §4-bis.4).
- **MediaSession (Step 3):** rimossi `MediaSessionCompat` +
  `MediaSessionConnector`, sostituiti da
  `androidx.media3.session.MediaSession` (auto-bound al `Player`).
  Release esplicito in `releasePlayer()`.
- **DefaultRenderersFactory (Step 3-bis):** abilitato
  `setEnableDecoderFallback(true)` + `EXTENSION_RENDERER_MODE_PREFER`
  per garantire fallback codec HEVC/AV1 graceful su OEM con decoder
  bacati.
- **DefaultTrackSelector (Step 3-bis):** `setTunnelingEnabled(true)`
  per HDR/4K + `setPreferredAudioLanguage` /
  `setPreferredTextLanguage` / `setSelectUndeterminedTextLanguage(true)`
  dal `Locale.getDefault()`.
- **HlsMediaSource (Step 3-bis):** `setAllowChunklessPreparation(true)`
  per ridurre TTFF di ~300 ms su provider Xtream.
- **DefaultLoadControl (Step 3-bis):** buffer IPTV-friendly
  `(minBufferMs=15s, maxBufferMs=50s, bufferForPlaybackMs=1.5s,
  bufferForPlaybackAfterRebufferMs=5s)` +
  `setPrioritizeTimeOverSizeThresholds(true)`.
- **Prepare API:** `player.prepare(mediaSource, false, false)` (rimosso
  in Media3) → `player.setMediaSource(mediaSource); player.prepare();`.
- **DefaultDataSourceFactory** → `DefaultDataSource.Factory(context)
  .setUpstreamDataSourceFactory(httpDataSourceFactory)` (rinominato e
  ora nested class di `DefaultDataSource`).
- **Util.SDK_INT** → `android.os.Build.VERSION.SDK_INT` (per evitare
  dipendenza da `androidx.media3.common.util.Util` annotata
  `@UnstableApi`).
- **player.getCurrentWindowIndex()** → `player.getCurrentMediaItemIndex()`
  (API moderna Media3, l'API legacy è stata rimossa).
- **Player.REPEAT_MODE_*** ora accessi statici espliciti
  (`Player.REPEAT_MODE_ONE` invece di `player.REPEAT_MODE_ONE`).
- **`@androidx.media3.common.util.UnstableApi`** a livello di classe per
  opt-in alle API non ancora stable di Media3 (HLS/DASH/SS factory,
  DefaultLoadControl, DefaultRenderersFactory, DefaultTrackSelector,
  Util).

### `android/src/main/res/layout/`

- `fragment_fs_exoplayer.xml`, `exo_playback_control_view.xml`,
  `exoplayer_layout_youtube.xml`: classi sostituite
  `com.google.android.exoplayer2.ui.StyledPlayerView` →
  `androidx.media3.ui.PlayerView`,
  `…AspectRatioFrameLayout` / `…DefaultTimeBar` / `…PlayerControlView`
  → `androidx.media3.ui.*`. Tutti gli attributi `app:show_buffering`,
  `app:resize_mode`, `app:player_layout_id`, `app:controller_layout_id`
  invariati (Media3 mantiene la stessa schema XML).

## Wiring lato monorepo

- `package.json`: `"capacitor-video-player": "file:android/plugins/capacitor-video-player"`.
- `android/capacitor.settings.gradle`: il path del progetto Gradle è
  proiettato manualmente su `./plugins/capacitor-video-player/android`.
  **Attenzione:** `npx cap sync android` rigenera questo file; se
  necessario ri-applicare la proiezione locale (vedi commento in testa al
  file).
- `android/app/proguard-rules.pro`: regole `-keep` per
  `androidx.media3.**`, `com.google.android.gms.cast.**` e per il package
  del plugin.

## Smoke matrix di accettazione

La parità funzionale completa è documentata in
`docs/IMPROVEMENT_PLAN.md` §4-bis.11 (10 codec video, 11 codec audio,
13 container/protocolli, 8 formati sottotitoli + feature trasversali).
Quel passaggio è **gate di rilascio** e richiede device fisico API 26+ o
emulatore con codec HW abilitati.

## Future work (rinviato a tranche separate)

- **MediaSessionService** per controllo audio persistente in
  background (D.5 audio-only mode).
- **AV1 software fallback** via `media3-decoder-av1` se la matrice device
  mostra > 5% incidenza di errori AV1 su API < 31.
- **Multi audio tracks UI** (D.4) — esposizione `Tracks.Group` filtrate
  per `C.TRACK_TYPE_AUDIO` con shortcut `A`.

