import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  Cpu,
  Gauge,
  Info,
  Network,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Tv,
  Video,
  Volume2,
  X,
  Zap,
} from 'lucide-react';
import { Badge, Button, Card, IconButton } from '../shared';
import type { StreamCodecInfo } from '../../services/streamInfoService';
import type { PlayerEngine, StreamSourceInfo } from './playerTypes';
import { getHwAccelStatus, type GpuStatus } from '../../services/hwAccelService';

/**
 * P8.2 — Schermata Info Stream / Diagnostica
 *
 * Pannello strutturato con codec, risoluzione, bitrate stimato, protocollo,
 * buffer health, errori recenti e URL redatto. Sostituisce il vecchio
 * <pre> testuale di VideoPlayerNew con un layout DS-v1 navigabile via
 * tastiera/telecomando (tv-focus su tutti i bottoni).
 */

export interface BufferStats {
  /** Numero di range bufferizzati riportati dal video element. */
  ranges: number;
  /** Secondi di buffer ancora davanti alla currentTime. */
  ahead: number;
  /** Secondi di buffer alle spalle della currentTime. */
  behind: number;
  /** Somma totale dei range (sec). */
  total: number;
  /** Posizione corrente di playback (sec). */
  currentTime: number;
}

export interface RecentPlaybackError {
  ts: number;
  title: string;
  message: string;
  category: string;
}

export interface StreamDiagnosticsProps {
  open: boolean;
  onClose: () => void;
  channelName: string;
  sanitizedUrl: string;
  engine: PlayerEngine;
  sourceInfo: StreamSourceInfo | null;
  info: StreamCodecInfo | null;
  bufferStats: BufferStats | null;
  recentErrors: RecentPlaybackError[];
  loading?: boolean;
  onRefresh?: () => void;
}

const RES_LABELS: Array<[number, string]> = [
  [2160, '4K UHD'],
  [1440, '2K QHD'],
  [1080, 'Full HD'],
  [720, 'HD'],
  [480, 'SD'],
];

function resolutionBadge(height: number): string {
  for (const [min, label] of RES_LABELS) {
    if (height >= min) return label;
  }
  return 'LD';
}

function formatBitrate(bps: number | null | undefined): string {
  if (!bps || !isFinite(bps) || bps <= 0) return '—';
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)} kbps`;
  return `${bps} bps`;
}

function formatChannels(n: number | null | undefined): string {
  if (!n) return '—';
  switch (n) {
    case 1: return 'Mono (1.0)';
    case 2: return 'Stereo (2.0)';
    case 6: return 'Surround 5.1';
    case 8: return 'Surround 7.1';
    default: return `${n} canali`;
  }
}

function formatSeconds(s: number): string {
  if (!isFinite(s)) return '—';
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  const rest = Math.floor(s % 60);
  return `${m}m ${rest}s`;
}

function bufferTone(ahead: number): 'success' | 'warning' | 'error' {
  if (ahead >= 8) return 'success';
  if (ahead >= 3) return 'warning';
  return 'error';
}

function confidenceTone(c: StreamCodecInfo['confidence']): 'success' | 'info' | 'warning' | 'neutral' {
  switch (c) {
    case 'high': return 'success';
    case 'medium': return 'info';
    case 'low': return 'warning';
    default: return 'neutral';
  }
}

interface RowProps {
  label: string;
  value: React.ReactNode;
  hint?: string;
}
const Row: React.FC<RowProps> = ({ label, value, hint }) => (
  <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-subtle last:border-b-0">
    <div className="min-w-0">
      <span className="text-xs uppercase tracking-wider text-content-muted">{label}</span>
      {hint && <p className="text-[11px] text-content-muted/80 mt-0.5">{hint}</p>}
    </div>
    <div className="text-sm font-mono text-content-primary text-right break-all">
      {value ?? '—'}
    </div>
  </div>
);

const SectionTitle: React.FC<{ icon: React.ElementType; children: React.ReactNode }> = ({ icon: Icon, children }) => (
  <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-content-secondary mb-2">
    <Icon className="w-icon-sm h-icon-sm text-brand-primary" aria-hidden="true" />
    {children}
  </h4>
);

const StreamDiagnostics: React.FC<StreamDiagnosticsProps> = ({
  open,
  onClose,
  channelName,
  sanitizedUrl,
  engine,
  sourceInfo,
  info,
  bufferStats,
  recentErrors,
  loading = false,
  onRefresh,
}) => {
  const copyUrl = useCallback(() => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        void navigator.clipboard.writeText(sanitizedUrl);
      }
    } catch {
      /* noop */
    }
  }, [sanitizedUrl]);

  const supportTone = useMemo<'success' | 'warning' | 'error' | 'neutral'>(() => {
    if (!info) return 'neutral';
    if (!info.isSupported) return 'error';
    if (info.frameDropRate > 5) return 'warning';
    return 'success';
  }, [info]);

  // Stato HW host (R22): lo fetchiamo all'apertura del pannello.
  const [gpu, setGpu] = useState<GpuStatus | null>(null);
  useEffect(() => {
    if (!open) return;
    let active = true;
    getHwAccelStatus().then((s) => { if (active) setGpu(s); }).catch(() => { /* noop */ });
    return () => { active = false; };
  }, [open]);

  if (!open) return null;

  const height = info?.height ?? null;
  const width = info?.width ?? null;
  const totalBitrate = info?.bitrate ?? null;
  const videoBitrate = info?.videoBitrate ?? totalBitrate;

  return (
    <aside
      role="dialog"
      aria-label="Diagnostica stream"
      className="absolute inset-y-0 right-0 z-[80] w-full max-w-xl bg-surface-0/95 backdrop-blur-xl border-l border-DEFAULT shadow-elev-3 flex flex-col animate-in slide-in-from-right duration-200"
    >
      {/* Header */}
      <header className="px-5 py-4 border-b border-subtle flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-content-primary font-bold flex items-center gap-2">
            <Info className="w-icon-md h-icon-md text-brand-primary" aria-hidden="true" />
            Diagnostica stream
          </h3>
          <p className="text-xs text-content-muted truncate max-w-md mt-0.5">{channelName}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onRefresh && (
            <IconButton
              icon={RefreshCw}
              aria-label="Aggiorna diagnostica"
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              disabled={loading}
              className={loading ? 'animate-spin' : ''}
            />
          )}
          <IconButton
            icon={X}
            aria-label="Chiudi diagnostica"
            variant="ghost"
            size="sm"
            onClick={onClose}
          />
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* Status chips */}
        <div className="flex flex-wrap gap-2">
          {sourceInfo && (
            <Badge tone="info" icon={Network} size="sm">{sourceInfo.label}</Badge>
          )}
          <Badge tone="neutral" icon={Cpu} size="sm">Engine: {engine}</Badge>
          {info?.videoCodec && (
            <Badge tone={info.isSupported ? 'success' : 'error'} icon={Video} size="sm">
              {info.videoCodec}
            </Badge>
          )}
          {info?.audioCodec && (
            <Badge tone="neutral" icon={Volume2} size="sm">{info.audioCodec}</Badge>
          )}
          {info?.videoHDR && (
            <Badge tone="accent" icon={Sparkles} size="sm">
              {info.isDolbyVision ? 'Dolby Vision' : info.isHDR10 ? 'HDR10' : info.isHLG ? 'HLG' : 'HDR'}
            </Badge>
          )}
          {bufferStats && (
            <Badge tone={bufferTone(bufferStats.ahead)} icon={Gauge} size="sm">
              Buffer {bufferStats.ahead.toFixed(1)}s
            </Badge>
          )}
          {recentErrors.length > 0 && (
            <Badge tone="error" icon={AlertTriangle} size="sm">
              {recentErrors.length} errori
            </Badge>
          )}
        </div>

        {/* HOST GPU / HW ACCEL */}
        {gpu && gpu.ok && (
          <Card padding="md" elevation="raised">
            <SectionTitle icon={Zap}>Host GPU &amp; HW decode</SectionTitle>
            <Row
              label="Video decode (Chromium)"
              value={
                <span className={gpu.accelerated ? 'text-state-success' : 'text-state-warning'}>
                  {gpu.accelerated ? 'Hardware' : 'Software'}
                  <span className="ml-2 text-content-muted">({gpu.videoDecode})</span>
                </span>
              }
              hint="da app.getGPUFeatureStatus()"
            />
            {gpu.switches.useGl && <Row label="GL backend" value={gpu.switches.useGl} />}
erèp            {gpu.switches.useAngle && <Row label="ANGLE backend" value={gpu.switches.useAngle} />}
            {gpu.switches.ozonePlatform && <Row label="Ozone platform" value={gpu.switches.ozonePlatform} />}
            {gpu.disabledByUser && (
              <Row label="Override utente" value={<span className="text-state-warning">STREAMAI_DISABLE_HW=1</span>} />
            )}
            {Boolean((gpu.gpuInfo as { auxAttributes?: { glRenderer?: string } })?.auxAttributes?.glRenderer) && (
              <Row
                label="GL renderer"
                value={(gpu.gpuInfo as { auxAttributes: { glRenderer: string } }).auxAttributes.glRenderer}
              />
            )}
          </Card>
        )}

        {/* VIDEO */}
        <Card padding="md" elevation="raised">
          <SectionTitle icon={Video}>Video</SectionTitle>
          <Row
            label="Codec"
            value={info?.videoCodec ? (
              <>
                {info.videoCodec}
                {info.videoProfile && <span className="text-content-muted"> ({info.videoProfile}{info.videoLevel ? ` L${info.videoLevel}` : ''})</span>}
              </>
            ) : 'Non rilevato'}
          />
          {info?.videoCodecId && <Row label="Codec ID" value={info.videoCodecId} />}
          <Row
            label="Risoluzione"
            value={width && height ? (
              <span>
                {width}×{height}
                <span className="ml-2 text-content-muted">{resolutionBadge(height)}</span>
              </span>
            ) : '—'}
          />
          {info?.frameRate ? <Row label="Frame rate" value={`${info.frameRate.toFixed(2)} fps`} /> : null}
          {info?.videoBitDepth ? <Row label="Bit depth" value={`${info.videoBitDepth}-bit`} /> : null}
          <Row label="Bitrate video" value={formatBitrate(videoBitrate)} hint="Stima dall'ABR / manifest" />
          {info?.videoColorSpace && <Row label="Color space" value={info.videoColorSpace} />}
        </Card>

        {/* AUDIO */}
        <Card padding="md" elevation="raised">
          <SectionTitle icon={Volume2}>Audio</SectionTitle>
          <Row label="Codec" value={info?.audioCodec || 'Non rilevato'} />
          {info?.audioCodecId && <Row label="Codec ID" value={info.audioCodecId} />}
          <Row label="Canali" value={formatChannels(info?.audioChannels ?? null)} />
          {info?.audioSampleRate ? <Row label="Sample rate" value={`${(info.audioSampleRate / 1000).toFixed(1)} kHz`} /> : null}
          {info?.audioBitrate ? <Row label="Bitrate audio" value={`${info.audioBitrate} kbps`} /> : null}
          {info?.audioLanguage && <Row label="Lingua" value={info.audioLanguage} />}
        </Card>

        {/* PROTOCOLLO & RETE */}
        <Card padding="md" elevation="raised">
          <SectionTitle icon={Network}>Protocollo &amp; rete</SectionTitle>
          <Row label="Protocollo" value={sourceInfo?.label || info?.protocol || '—'} />
          {info?.container && <Row label="Container" value={info.container} />}
          {sourceInfo?.mimeType && <Row label="MIME type" value={sourceInfo.mimeType} />}
          <Row label="Engine" value={engine} />
          <Row label="Bitrate totale" value={formatBitrate(totalBitrate)} />
          {info?.downloadSpeed != null && (
            <Row label="Download" value={`${(info.downloadSpeed / 1_000_000).toFixed(2)} Mbps`} />
          )}
          {info?.latency != null && (
            <Row label="Latency" value={`${info.latency.toFixed(0)} ms`} />
          )}
        </Card>

        {/* BUFFER HEALTH */}
        <Card padding="md" elevation="raised">
          <SectionTitle icon={Gauge}>Buffer health</SectionTitle>
          {bufferStats ? (
            <>
              <Row
                label="Avanti"
                value={
                  <span className={
                    bufferTone(bufferStats.ahead) === 'success'
                      ? 'text-state-success'
                      : bufferTone(bufferStats.ahead) === 'warning'
                        ? 'text-state-warning'
                        : 'text-state-error'
                  }>
                    {bufferStats.ahead.toFixed(1)} s
                  </span>
                }
                hint="Secondi pronti dopo la posizione corrente"
              />
              <Row label="Indietro" value={`${bufferStats.behind.toFixed(1)} s`} />
              <Row label="Totale bufferizzato" value={formatSeconds(bufferStats.total)} />
              <Row label="Range attivi" value={bufferStats.ranges.toString()} />
              <Row label="Tempo corrente" value={formatSeconds(bufferStats.currentTime)} />
              {info && info.totalFrames > 0 && (
                <Row
                  label="Frame persi"
                  value={
                    <span className={info.frameDropRate > 1 ? 'text-state-warning' : 'text-state-success'}>
                      {info.droppedFrames} / {info.totalFrames} ({info.frameDropRate.toFixed(2)}%)
                    </span>
                  }
                />
              )}
            </>
          ) : (
            <p className="text-sm text-content-muted">Nessuna informazione sul buffer disponibile.</p>
          )}
        </Card>

        {/* SUPPORTO */}
        {info && (
          <Card padding="md" elevation="raised">
            <SectionTitle icon={supportTone === 'success' ? CheckCircle2 : supportTone === 'warning' ? AlertTriangle : ShieldAlert}>
              Supporto &amp; decodifica
            </SectionTitle>
            <Row label="Stato" value={
              <span className={
                supportTone === 'success' ? 'text-state-success'
                  : supportTone === 'warning' ? 'text-state-warning'
                  : supportTone === 'error' ? 'text-state-error'
                  : ''
              }>
                {info.supportDetails || (info.isSupported ? 'Supportato' : 'Non supportato')}
              </span>
            } />
            <Row label="Decodifica HW" value={info.hardwareAccelerated ? 'Attiva' : info.isSupported ? 'Software' : '—'} />
            {info.powerEfficient && <Row label="Efficienza" value="Power efficient" />}
            <Row label="Metodo rilevamento" value={info.detectionMethod || '—'} />
            <Row
              label="Affidabilità"
              value={
                <Badge tone={confidenceTone(info.confidence)} size="xs">
                  {info.confidence === 'high' ? 'ALTA' : info.confidence === 'medium' ? 'MEDIA' : info.confidence === 'low' ? 'BASSA' : 'N/D'}
                </Badge>
              }
            />
          </Card>
        )}

        {/* ERRORI RECENTI */}
        <Card padding="md" elevation="raised">
          <SectionTitle icon={AlertTriangle}>Errori recenti</SectionTitle>
          {recentErrors.length === 0 ? (
            <p className="text-sm text-content-muted flex items-center gap-2">
              <CheckCircle2 className="w-icon-sm h-icon-sm text-state-success" aria-hidden="true" />
              Nessun errore registrato in questa sessione.
            </p>
          ) : (
            <ul className="space-y-2">
              {recentErrors.slice(0, 10).map((err, idx) => (
                <li
                  key={`${err.ts}-${idx}`}
                  className="text-xs bg-surface-1 border border-subtle rounded-control p-2"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-semibold text-state-error truncate">{err.title}</span>
                    <span className="text-content-muted shrink-0">
                      {new Date(err.ts).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-content-secondary leading-snug">{err.message}</p>
                  {err.category && (
                    <span className="inline-block mt-1 text-[10px] uppercase tracking-wider text-content-muted">
                      {err.category}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* URL REDATTO */}
        <Card padding="md" elevation="raised">
          <SectionTitle icon={Tv}>URL stream</SectionTitle>
          <div className="font-mono text-xs bg-surface-1 border border-subtle rounded-control p-2 break-all text-content-secondary select-all">
            {sanitizedUrl || '—'}
          </div>
          <div className="flex items-center justify-between gap-2 mt-3">
            <p className="text-[11px] text-content-muted">
              Username, password e token sono mascherati con <code>***</code>.
            </p>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={Clipboard}
              onClick={copyUrl}
              focusVariant="dense"
            >
              Copia
            </Button>
          </div>
        </Card>

        {/* WARNINGS */}
        {info && (
          (() => {
            const warns: string[] = [];
            if (info.isHEVC && !info.isSupported) warns.push('HEVC/H.265 non supportato dal motore corrente.');
            if (info.isDolbyVision) warns.push('Dolby Vision: supporto browser limitato.');
            if (info.videoHDR && !info.isDolbyVision) warns.push('Contenuto HDR: richiede display compatibile.');
            if (info.frameDropRate > 5) warns.push('Alto tasso di frame drop: possibili problemi di performance.');
            if (info.videoBitDepth && info.videoBitDepth > 8 && !info.hardwareAccelerated) {
              warns.push('Video 10-bit senza accelerazione HW.');
            }
            if (gpu && gpu.ok && !gpu.accelerated && !gpu.disabledByUser) {
              warns.push(
                'Chromium sta usando il decoder video SOFTWARE (silent fallback driver). '
                + 'Verifica VA-API/Media Foundation/VideoToolbox; vedi chrome://gpu.'
              );
            }
            if (warns.length === 0) return null;
            return (
              <Card padding="md" elevation="flat" className="border-state-warning/40 bg-state-warning/5">
                <SectionTitle icon={AlertTriangle}>Avvisi</SectionTitle>
                <ul className="space-y-1 text-sm text-state-warning">
                  {warns.map((w, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span aria-hidden="true">•</span>
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })()
        )}
      </div>

      {/* Footer */}
      <footer className="px-5 py-3 border-t border-subtle flex items-center justify-between gap-2">
        <p className="text-[11px] text-content-muted flex items-center gap-1.5">
          <Activity className="w-icon-xs h-icon-xs" aria-hidden="true" />
          Dati raccolti localmente. Nessuna telemetria inviata.
        </p>
        <Button variant="ghost" size="sm" onClick={onClose} focusVariant="dense">
          Chiudi
        </Button>
      </footer>
    </aside>
  );
};

export default StreamDiagnostics;

