import React, { useEffect, useState } from 'react';
import { AlertTriangle, X, Info, CheckCircle, XCircle, Cpu } from 'lucide-react';
import { checkCodecSupport, CodecCheckResult } from '../services/codecChecker';

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
    <div className="fixed bottom-4 right-4 z-[200] max-w-md animate-slide-up">
      <div className="bg-gradient-to-br from-amber-900/95 to-orange-900/95 backdrop-blur-xl rounded-2xl border border-amber-500/30 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-amber-500/20">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/20 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h3 className="font-bold text-white text-sm">Codec HEVC Non Disponibile</h3>
              <p className="text-xs text-amber-200/70">Alcuni contenuti 4K potrebbero non funzionare</p>
            </div>
          </div>
          <button
            onClick={() => handleDismiss(false)}
            className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
          >
            <X className="w-4 h-4 text-white/70" />
          </button>
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
          <div className={`flex items-center gap-2 text-xs ${hardwareAcceleration ? 'text-green-400' : 'text-amber-400'}`}>
            <Cpu className="w-3.5 h-3.5" />
            <span>Accelerazione Hardware: {hardwareAcceleration ? 'Attiva' : 'Non rilevata'}</span>
          </div>
        </div>

        {/* Expandable Details */}
        {recommendations.length > 0 && (
          <>
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="w-full px-4 py-2 flex items-center justify-between text-xs text-amber-200 hover:bg-white/5 transition-colors border-t border-amber-500/20"
            >
              <span className="flex items-center gap-2">
                <Info className="w-3.5 h-3.5" />
                Come risolvere
              </span>
              <span className={`transform transition-transform ${showDetails ? 'rotate-180' : ''}`}>▼</span>
            </button>

            {showDetails && (
              <div className="px-4 pb-4 text-xs text-amber-100/80 space-y-2 animate-fade-in">
                {recommendations.map((rec, i) => (
                  <p key={i} className={rec.startsWith('•') ? 'pl-3 font-mono text-amber-200/60' : 'font-medium'}>
                    {rec}
                  </p>
                ))}
              </div>
            )}
          </>
        )}

        {/* Actions */}
        <div className="p-3 bg-black/20 flex items-center justify-between gap-2 text-xs">
          <button
            onClick={() => handleDismiss(true)}
            className="px-3 py-1.5 text-amber-200/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            Non mostrare più
          </button>
          <button
            onClick={() => handleDismiss(false)}
            className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-medium rounded-lg transition-colors"
          >
            Ho capito
          </button>
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
    flex flex-col items-center gap-1 p-2 rounded-lg text-center
    ${highlight && !supported ? 'bg-red-500/20 ring-1 ring-red-500/50' : 'bg-white/5'}
  `}>
    {supported ? (
      <CheckCircle className="w-4 h-4 text-green-400" />
    ) : (
      <XCircle className={`w-4 h-4 ${highlight ? 'text-red-400' : 'text-gray-500'}`} />
    )}
    <span className={`text-xs font-medium ${
      supported ? 'text-green-300' : highlight ? 'text-red-300' : 'text-gray-400'
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

