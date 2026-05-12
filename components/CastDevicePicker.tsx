import React, { useState, useEffect, useCallback } from 'react';
import { X, Search, Tv, Smartphone, Monitor, Wifi, WifiOff, Loader2, Plus, Cast, Check, AlertCircle } from 'lucide-react';
import { deviceDiscovery, DiscoveredDevice, DeviceDiscoveryState } from '../services/deviceDiscovery.ts';

interface CastDevicePickerProps {
  isOpen: boolean;
  onClose: () => void;
  mediaUrl: string;
  mediaTitle: string;
  mediaPoster?: string;
  onDeviceSelect?: (device: DiscoveredDevice) => Promise<boolean>;
  onCastStart?: (device: DiscoveredDevice) => void;
  onCastSuccess?: (device: DiscoveredDevice) => void;
  onCastError?: (error: string) => void;
}

const CastDevicePicker: React.FC<CastDevicePickerProps> = ({
  isOpen,
  onClose,
  mediaUrl,
  mediaTitle,
  onDeviceSelect,
  onCastStart,
  onCastSuccess,
  onCastError,
}) => {
  const [state, setState] = useState<DeviceDiscoveryState>({
    isSearching: false,
    devices: [],
    error: null,
    progress: { phase: 'Inattivo', scannedHosts: 0, totalHosts: 0 },
    lastUpdatedAt: null,
  });
  const [selectedDevice, setSelectedDevice] = useState<DiscoveredDevice | null>(null);
  const [isCasting, setIsCasting] = useState(false);
  const [castSuccess, setCastSuccess] = useState(false);
  const [castError, setCastError] = useState<string | null>(null);
  const [manualIP, setManualIP] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const unsubscribe = deviceDiscovery.subscribe(setState);
    deviceDiscovery.startDiscovery();

    return () => {
      unsubscribe();
      deviceDiscovery.stopDiscovery();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedDevice(null);
      setIsCasting(false);
      setCastSuccess(false);
      setCastError(null);
      setShowManualInput(false);
      setManualIP('');
    }
  }, [isOpen]);

  const handleDeviceSelect = useCallback(async (device: DiscoveredDevice) => {
    if (device.id === 'manual') {
      setShowManualInput(true);
      return;
    }

    setSelectedDevice(device);
    setIsCasting(true);
    setCastSuccess(false);
    setCastError(null);
    onCastStart?.(device);

    try {
      let success: boolean;

      // Use the callback if provided (new session-based approach)
      if (onDeviceSelect) {
        success = await onDeviceSelect(device);
      } else {
        // Fallback to old method
        success = await deviceDiscovery.sendToDevice(device, mediaUrl, mediaTitle);
      }

      if (success) {
        setCastSuccess(true);
        onCastSuccess?.(device);
        setTimeout(() => onClose(), 1500);
      } else {
        await navigator.clipboard.writeText(mediaUrl);
        const message = `Impossibile connettersi a ${device.name}. URL copiato negli appunti.`;
        setCastError(message);
        onCastError?.(message);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : `Errore di connessione a ${device.name}`;
      setCastError(message);
      onCastError?.(message);
    } finally {
      setIsCasting(false);
    }
  }, [mediaUrl, mediaTitle, onDeviceSelect, onCastStart, onCastSuccess, onCastError, onClose]);

  const handleManualAdd = useCallback(async () => {
    if (!manualIP.trim()) return;

    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipRegex.test(manualIP.trim())) {
      onCastError?.('Formato IP non valido. Usa: 192.168.1.100');
      return;
    }

    setIsCasting(true);
    try {
      const device = await deviceDiscovery.addManualDevice(manualIP.trim());
      setShowManualInput(false);
      setManualIP('');
      handleDeviceSelect(device);
    } catch (err) {
      onCastError?.('Errore durante la verifica del dispositivo');
      setIsCasting(false);
    }
  }, [manualIP, handleDeviceSelect, onCastError]);

  const handleRefresh = useCallback(() => {
    deviceDiscovery.startDiscovery(true);
  }, []);

  const handleStopSearch = useCallback(() => {
    deviceDiscovery.stopDiscovery();
  }, []);

  const getDeviceIcon = (type: DiscoveredDevice['type']) => {
    switch (type) {
      case 'chromecast': return <Cast className="w-6 h-6" />;
      case 'smarttv': return <Tv className="w-6 h-6" />;
      case 'androidtv': return <Monitor className="w-6 h-6" />;
      case 'dlna': return <Wifi className="w-6 h-6" />;
      default: return <Smartphone className="w-6 h-6" />;
    }
  };

  const getDeviceColor = (type: DiscoveredDevice['type']) => {
    switch (type) {
      case 'chromecast': return 'text-blue-400';
      case 'smarttv': return 'text-green-400';
      case 'androidtv': return 'text-purple-400';
      case 'dlna': return 'text-orange-400';
      default: return 'text-gray-400';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <Cast className="w-6 h-6 text-blue-400" />
            <h2 className="text-lg font-semibold text-white">Trasmetti su</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content info */}
        <div className="px-4 py-3 bg-white/5 border-b border-white/10">
          <p className="text-sm text-gray-400">Contenuto:</p>
          <p className="text-white font-medium truncate">{mediaTitle}</p>
        </div>

        {/* Device list */}
        <div className="max-h-[350px] overflow-y-auto">
          {state.isSearching && (
            <div className="px-4 py-3 text-blue-400 border-b border-white/10 bg-blue-500/5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" />
                  <div className="min-w-0">
                    <span className="text-sm font-medium block truncate">{state.progress.phase || 'Ricerca dispositivi in corso...'}</span>
                    {state.progress.totalHosts > 0 && (
                      <span className="text-xs text-blue-200/70">{state.progress.scannedHosts}/{state.progress.totalHosts} host verificati</span>
                    )}
                  </div>
                </div>
                <button onClick={handleStopSearch} className="tv-focus px-3 py-1 text-xs rounded-lg bg-white/10 hover:bg-white/20 text-white">
                  Annulla
                </button>
              </div>
              {state.progress.totalHosts > 0 && (
                <div className="mt-3 h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all"
                    style={{ width: `${Math.min(100, (state.progress.scannedHosts / state.progress.totalHosts) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {showManualInput && (
            <div className="p-4 border-b border-white/10 bg-white/5">
              <p className="text-sm text-gray-400 mb-2">Inserisci l'indirizzo IP del dispositivo:</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualIP}
                  onChange={(e) => setManualIP(e.target.value)}
                  placeholder="192.168.1.100"
                  className="flex-1 bg-black/50 border border-white/20 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  onKeyDown={(e) => e.key === 'Enter' && handleManualAdd()}
                  autoFocus
                />
                <button onClick={handleManualAdd} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors">
                  Connetti
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-2">Trova l'IP nelle impostazioni di rete del dispositivo</p>
            </div>
          )}

          {castError && (
            <div className="mx-4 mt-3 rounded-xl border border-red-500/30 bg-red-950/40 px-4 py-3 text-sm text-red-100 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-300 flex-shrink-0 mt-0.5" />
              <span>{castError}</span>
            </div>
          )}

          {state.devices.length > 0 ? (
            <div className="py-2">
              {state.devices.map((device) => (
                <button
                  key={device.id}
                  onClick={() => handleDeviceSelect(device)}
                  disabled={isCasting}
                  className={`w-full flex items-center gap-4 px-4 py-3 hover:bg-white/10 transition-colors text-left ${selectedDevice?.id === device.id ? 'bg-white/10' : ''} ${isCasting ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {device.id === 'manual' ? (
                    <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                      <Plus className="w-5 h-5 text-gray-400" />
                    </div>
                  ) : (
                    <div className={`w-10 h-10 rounded-full bg-white/10 flex items-center justify-center ${getDeviceColor(device.type)}`}>
                      {getDeviceIcon(device.type)}
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium truncate">{device.name}</p>
                    {device.ip && <p className="text-xs text-gray-500">{device.ip}</p>}
                  </div>

                  {selectedDevice?.id === device.id && (
                    <div className="flex-shrink-0">
                      {isCasting ? <Loader2 className="w-5 h-5 text-blue-400 animate-spin" /> : castSuccess ? <Check className="w-5 h-5 text-green-400" /> : null}
                    </div>
                  )}
                </button>
              ))}
            </div>
          ) : !state.isSearching ? (
            <div className="py-8 text-center">
              <WifiOff className="w-12 h-12 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400">Nessun dispositivo trovato</p>
              <p className="text-sm text-gray-500 mt-1 px-6">Assicurati che i dispositivi siano accesi, sulla stessa rete Wi‑Fi/LAN e che VPN/firewall non blocchino SSDP, DIAL o Chromecast.</p>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 bg-black/30">
          <div className="flex items-center justify-between">
            <button onClick={handleRefresh} disabled={state.isSearching} className="tv-focus flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-white transition-colors disabled:opacity-50">
              <Search className={`w-4 h-4 ${state.isSearching ? 'animate-spin' : ''}`} />
              Aggiorna
            </button>
            <button
              onClick={() => {
                navigator.clipboard.writeText(mediaUrl);
                onCastError?.('URL copiato negli appunti!');
              }}
              className="tv-focus px-4 py-2 text-sm bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors"
            >
              Copia URL
            </button>
          </div>

          <div className="mt-3 p-3 bg-white/5 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-gray-400">
                <strong className="text-gray-300">Suggerimento:</strong> Se il dispositivo non appare, inserisci l'IP manualmente o copia l'URL e incollalo nell'app del dispositivo (VLC, Kodi, IPTV Smarters)
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CastDevicePicker;

