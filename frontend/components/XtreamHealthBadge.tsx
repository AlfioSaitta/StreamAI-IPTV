// Xtream account health badge (F.3 IMPROVEMENT_PLAN_V2).
// Migrato a Design System v1 (UI-1.3.4): tokens surface/state/content, no
// hard-coded red/green/yellow. Refresh on demand o ogni 30 min via hook.

import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { RefreshCw, ShieldCheck, ShieldAlert, ShieldX, Activity, Clock } from 'lucide-react';
import type { XtreamCredentials } from '../types';
import { useXtreamHealthCheck } from '../hooks/useXtreamHealthCheck';
import { Button, Card } from './shared';

interface XtreamHealthBadgeProps {
  creds: XtreamCredentials | null;
}

const formatExpDate = (expDate: string | null | undefined): string => {
  if (!expDate || expDate === '0' || expDate === 'null') return 'Illimitato';
  const epoch = Number(expDate);
  if (!Number.isFinite(epoch) || epoch <= 0) return 'Illimitato';
  try {
    return new Date(epoch * 1000).toLocaleDateString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return 'Sconosciuto';
  }
};

type HealthStatus = 'idle' | 'loading' | 'ok' | 'expiring' | 'expired' | 'error';

interface HealthTheme {
  /** Classi per il container del badge (background + border tinta). */
  container: string;
  /** Icona del titolo (Lucide). */
  icon: LucideIcon;
  /** Tono accent per icona, contatori e suffix. */
  accent: string;
}

// Token-driven: ogni status ha un solo tono semantico DS, niente
// red-300/400/500 sparsi.
const HEALTH_THEMES: Record<HealthStatus, HealthTheme> = {
  idle:     { container: 'bg-surface-1 border-DEFAULT',                   icon: ShieldCheck, accent: 'text-content-muted' },
  loading:  { container: 'bg-surface-1 border-DEFAULT',                   icon: RefreshCw,   accent: 'text-state-info' },
  ok:       { container: 'bg-state-success/10 border-state-success/30',   icon: ShieldCheck, accent: 'text-state-success' },
  expiring: { container: 'bg-state-warning/10 border-state-warning/30',   icon: ShieldAlert, accent: 'text-state-warning' },
  expired:  { container: 'bg-state-error/10 border-state-error/30',       icon: ShieldX,     accent: 'text-state-error' },
  error:    { container: 'bg-state-error/10 border-state-error/30',       icon: ShieldX,     accent: 'text-state-error' },
};

const XtreamHealthBadge: React.FC<XtreamHealthBadgeProps> = ({ creds }) => {
  const { state, refresh } = useXtreamHealthCheck(creds);

  if (!creds) return null;

  const { status, info, error, daysToExpiry } = state;
  const theme = HEALTH_THEMES[status];
  const Icon = theme.icon;

  let title = 'Stato account Xtream';
  if (status === 'loading' && !info) title = 'Verifica account...';
  else if (status === 'ok') title = 'Account attivo';
  else if (status === 'expiring') title = `Account in scadenza tra ${daysToExpiry} giorni`;
  else if (status === 'expired') title = 'Account scaduto';
  else if (status === 'error') title = 'Impossibile contattare il provider';

  const expLabel = formatExpDate(info?.expDate);
  const lastFetchLabel = info
    ? new Date(info.fetchedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <Card elevation="raised" padding="lg" className={`${theme.container} border`}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <Icon className={`w-icon-lg h-icon-lg mt-0.5 flex-shrink-0 ${theme.accent} ${status === 'loading' ? 'animate-spin' : ''}`} aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="font-semibold text-content-primary">{title}</h3>
            {error && (
              <p className="text-xs text-state-error mt-1 break-all">{error}</p>
            )}
            {info?.username && (
              <p className="text-xs text-content-muted mt-1 truncate">
                Utente: <span className="text-content-secondary font-mono">{info.username}</span>
              </p>
            )}
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={refresh}
          disabled={status === 'loading'}
          aria-label="Aggiorna stato account"
          leftIcon={RefreshCw}
          className={status === 'loading' ? '[&_svg]:animate-spin' : ''}
        >
          Aggiorna
        </Button>
      </div>

      {info && (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div className="bg-surface-2 rounded-control px-3 py-2 border border-subtle">
            <div className="flex items-center gap-2 text-content-muted text-xs uppercase tracking-wide">
              <Clock className="w-icon-xs h-icon-xs" aria-hidden="true" /> Scadenza
            </div>
            <div className="mt-1 text-content-primary font-medium">{expLabel}</div>
            {daysToExpiry !== null && daysToExpiry !== undefined && (
              <div className={`text-xs mt-0.5 ${theme.accent}`}>
                {daysToExpiry > 0 ? `${daysToExpiry} giorni rimanenti` : 'Scaduto'}
              </div>
            )}
          </div>

          <div className="bg-surface-2 rounded-control px-3 py-2 border border-subtle">
            <div className="flex items-center gap-2 text-content-muted text-xs uppercase tracking-wide">
              <Activity className="w-icon-xs h-icon-xs" aria-hidden="true" /> Connessioni
            </div>
            <div className="mt-1 text-content-primary font-medium">
              {info.activeConnections ?? '—'} / {info.maxConnections ?? '—'}
            </div>
            <div className="text-xs mt-0.5 text-content-muted">attive / max</div>
          </div>

          <div className="bg-surface-2 rounded-control px-3 py-2 border border-subtle">
            <div className="flex items-center gap-2 text-content-muted text-xs uppercase tracking-wide">
              Stato
            </div>
            <div className="mt-1 text-content-primary font-medium">{info.status || '—'}</div>
            {info.isTrial === '1' && (
              <div className="text-xs mt-0.5 text-state-warning">Account trial</div>
            )}
          </div>
        </div>
      )}

      {lastFetchLabel && (
        <p className="text-[10px] text-content-disabled mt-3">
          Ultimo controllo: {lastFetchLabel} · si aggiorna ogni 30 min
        </p>
      )}
    </Card>
  );
};

export default XtreamHealthBadge;

