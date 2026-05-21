import React, { useEffect, useState } from 'react';
import { AlertTriangle, X, Info, CheckCircle, XCircle, Cpu } from 'lucide-react';
import { checkCodecSupport, CodecCheckResult } from '../services/codecChecker';
import { Button, IconButton } from './shared';

interface CodecWarningProps {
  onDismiss?: () => void;
}

const CodecWarning: React.FC<CodecWarningProps> = ({ onDismiss }) => {
  const [codecResult, setCodecResult] = useState<CodecCheckResult | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Controlla se l'utente ha già dismissato l'avviso
    const wasDismissed = localStorage.getItem('codec_warning_dismissed');
    if (wasDismissed) {
      setDismissed(true);
      return;
    }

    // Esegui il check dei codec
    checkCodecSupport().then(result => {
      setCodecResult(result);
      // Se HEVC è supportato, non mostrare l'avviso
      if (result.supported.hevc) {
        setDismissed(true);
      }
    });
  }, []);

  const handleDismiss = (permanent: boolean = false) => {
    if (permanent) {
      localStorage.setItem('codec_warning_dismissed', 'true');
    }
    setDismissed(true);
    onDismiss?.();
  };


  // Non mostrare se dismissato o se non ci sono risultati
  if (dismissed || !codecResult) return null;

  // Non mostrare se HEVC è supportato
  if (codecResult.supported.hevc) return null;

  const { supported, hardwareAcceleration, recommendations } = codecResult;

  return (
    <div
      className="fixed z-[200] max-w-md w-[calc(100vw-2rem)] animate-slide-up"
      style={{
        bottom: 'max(1rem, calc(var(--safe-bottom) + 0.5rem))',
        right: 'max(1rem, calc(var(--safe-right) + 0.5rem))',
      }}
    >
      <div className="bg-surface-overlay-hard backdrop-blur-xl rounded-card border border-state-warning/30 shadow-elev-3 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-state-warning/20">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-state-warning/15 rounded-control">
              <AlertTriangle className="w-icon-md h-icon-md text-state-warning" />
            </div>
            <div>
              <h3 className="font-bold text-content-primary text-sm">Codec HEVC Non Disponibile</h3>
              <p className="text-xs text-content-muted">Alcuni contenuti 4K potrebbero non funzionare</p>
            </div>
          </div>
          <IconButton
            icon={X}
            aria-label="Chiudi avviso codec"
            variant="ghost"
            size="sm"
            onClick={() => handleDismiss(false)}
          />
        </div>

        {/* Codec Status Grid */}
        <div className="p-4 grid grid-cols-4 gap-2">
          <CodecBadge name="H.264" supported={supported.h264} />
          <CodecBadge name="HEVC" supported={supported.hevc} highlight />
          <CodecBadge name="AV1" supported={supported.av1} />
          <CodecBadge name="VP9" supported={supported.vp9} />
        </div>

        {/* Hardware Acceleration Status */}
        <div className="px-4 pb-3">
          <div className={`flex items-center gap-2 text-xs ${hardwareAcceleration ? 'text-state-success' : 'text-state-warning'}`}>
            <Cpu className="w-icon-xs h-icon-xs" />
            <span>Accelerazione Hardware: {hardwareAcceleration ? 'Attiva' : 'Non rilevata'}</span>
          </div>
        </div>

        {/* Expandable Details */}
        {recommendations.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setShowDetails(!showDetails)}
              className="tv-focus-dense w-full px-4 py-2 flex items-center justify-between text-xs text-content-secondary hover:bg-surface-2 transition-colors border-t border-state-warning/20"
            >
              <span className="flex items-center gap-2">
                <Info className="w-icon-xs h-icon-xs" />
                Come risolvere
              </span>
              <span className={`transform transition-transform ${showDetails ? 'rotate-180' : ''}`}>▼</span>
            </button>

            {showDetails && (
              <div className="px-4 pb-4 text-xs text-content-secondary space-y-2 animate-fade-in">
                {recommendations.map((rec, i) => (
                  <p key={i} className={rec.startsWith('•') ? 'pl-3 font-mono text-content-muted' : 'font-medium'}>
                    {rec}
                  </p>
                ))}
              </div>
            )}
          </>
        )}

        {/* Actions */}
        <div className="p-3 bg-surface-2 flex items-center justify-between gap-2 text-xs">
          <Button variant="ghost" size="sm" onClick={() => handleDismiss(true)}>
            Non mostrare più
          </Button>
          <Button variant="primary" size="sm" onClick={() => handleDismiss(false)}>
            Ho capito
          </Button>
        </div>
      </div>
    </div>
  );
};

// Componente Badge per singolo codec
const CodecBadge: React.FC<{ name: string; supported: boolean; highlight?: boolean }> = ({
  name,
  supported,
  highlight
}) => (
  <div className={`
    flex flex-col items-center gap-1 p-2 rounded-control text-center
    ${highlight && !supported ? 'bg-state-error/15 ring-1 ring-state-error/40' : 'bg-surface-2'}
  `}>
    {supported ? (
      <CheckCircle className="w-icon-sm h-icon-sm text-state-success" />
    ) : (
      <XCircle className={`w-icon-sm h-icon-sm ${highlight ? 'text-state-error' : 'text-content-disabled'}`} />
    )}
    <span className={`text-xs font-medium ${
      supported ? 'text-state-success' : highlight ? 'text-state-error' : 'text-content-muted'
    }`}>
      {name}
    </span>
  </div>
);

export default CodecWarning;

// Esporta anche una funzione per resettare il dismiss
export const resetCodecWarningDismiss = () => {
  localStorage.removeItem('codec_warning_dismissed');
};

