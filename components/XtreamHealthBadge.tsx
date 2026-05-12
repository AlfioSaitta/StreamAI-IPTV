// Xtream account health badge (F.3 IMPROVEMENT_PLAN_V2).
// Shows expiry date, days remaining, active/max connections and a traffic
// light status indicator. Refresh on demand or every 30 min via the hook.

import React from 'react';
import { RefreshCw, ShieldCheck, ShieldAlert, ShieldX, Activity, Clock } from 'lucide-react';
import type { XtreamCredentials } from '../types';
import { useXtreamHealthCheck } from '../hooks/useXtreamHealthCheck';

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

const XtreamHealthBadge: React.FC<XtreamHealthBadgeProps> = ({ creds }) => {
  const { state, refresh } = useXtreamHealthCheck(creds);

  if (!creds) return null;

  const { status, info, error, daysToExpiry } = state;

  // Color theme per status.
  const theme = {
    idle:     { bg: 'bg-gray-800/60', border: 'border-white/10', text: 'text-gray-300', icon: ShieldCheck, accent: 'text-gray-400' },
    loading:  { bg: 'bg-gray-800/60', border: 'border-white/10', text: 'text-gray-300', icon: RefreshCw,   accent: 'text-blue-400' },
    ok:       { bg: 'bg-green-950/30', border: 'border-green-500/30', text: 'text-green-200', icon: ShieldCheck, accent: 'text-green-400' },
    expiring: { bg: 'bg-yellow-950/30', border: 'border-yellow-500/30', text: 'text-yellow-100', icon: ShieldAlert, accent: 'text-yellow-400' },
    expired:  { bg: 'bg-red-950/30', border: 'border-red-500/30', text: 'text-red-100', icon: ShieldX, accent: 'text-red-400' },
    error:    { bg: 'bg-red-950/30', border: 'border-red-500/30', text: 'text-red-100', icon: ShieldX, accent: 'text-red-400' },
  }[status];
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
    <div className={`rounded-2xl border ${theme.border} ${theme.bg} p-5`}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <Icon className={`w-6 h-6 mt-0.5 flex-shrink-0 ${theme.accent} ${status === 'loading' ? 'animate-spin' : ''}`} />
          <div className="min-w-0">
            <h3 className={`font-semibold ${theme.text}`}>{title}</h3>
            {error && (
              <p className="text-xs text-red-300 mt-1 break-all">{error}</p>
            )}
            {info?.username && (
              <p className="text-xs text-gray-400 mt-1 truncate">
                Utente: <span className="text-gray-200 font-mono">{info.username}</span>
              </p>
            )}
          </div>
        </div>
        <button
          onClick={refresh}
          disabled={status === 'loading'}
          aria-label="Aggiorna stato account"
          className="tv-focus touch-target px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`w-4 h-4 ${status === 'loading' ? 'animate-spin' : ''}`} />
          Aggiorna
        </button>
      </div>

      {info && (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div className="bg-black/30 rounded-xl px-3 py-2 border border-white/5">
            <div className="flex items-center gap-2 text-gray-400 text-xs uppercase tracking-wide">
              <Clock className="w-3.5 h-3.5" /> Scadenza
            </div>
            <div className="mt-1 text-white font-medium">{expLabel}</div>
            {daysToExpiry !== null && daysToExpiry !== undefined && (
              <div className={`text-xs mt-0.5 ${theme.accent}`}>
                {daysToExpiry > 0 ? `${daysToExpiry} giorni rimanenti` : 'Scaduto'}
              </div>
            )}
          </div>

          <div className="bg-black/30 rounded-xl px-3 py-2 border border-white/5">
            <div className="flex items-center gap-2 text-gray-400 text-xs uppercase tracking-wide">
              <Activity className="w-3.5 h-3.5" /> Connessioni
            </div>
            <div className="mt-1 text-white font-medium">
              {info.activeConnections ?? '—'} / {info.maxConnections ?? '—'}
            </div>
            <div className="text-xs mt-0.5 text-gray-400">attive / max</div>
          </div>

          <div className="bg-black/30 rounded-xl px-3 py-2 border border-white/5">
            <div className="flex items-center gap-2 text-gray-400 text-xs uppercase tracking-wide">
              Stato
            </div>
            <div className="mt-1 text-white font-medium">{info.status || '—'}</div>
            {info.isTrial === '1' && (
              <div className="text-xs mt-0.5 text-yellow-300">Account trial</div>
            )}
          </div>
        </div>
      )}

      {lastFetchLabel && (
        <p className="text-[10px] text-gray-500 mt-3">
          Ultimo controllo: {lastFetchLabel} · si aggiorna ogni 30 min
        </p>
      )}
    </div>
  );
};

export default XtreamHealthBadge;

