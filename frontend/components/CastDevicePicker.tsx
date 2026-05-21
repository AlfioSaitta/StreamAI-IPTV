import React, { useState, useEffect, useCallback } from 'react';
import { Search, Tv, Smartphone, Monitor, Wifi, WifiOff, Loader2, Plus, Cast, Check, AlertCircle } from 'lucide-react';
import { deviceDiscovery, DiscoveredDevice, DeviceDiscoveryState } from '../services/deviceDiscovery.ts';
import { Button, Modal, Input } from './shared';

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

      if (onDeviceSelect) {
        success = await onDeviceSelect(device);
      } else {
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
      case 'chromecast': return <Cast className="w-icon-lg h-icon-lg" aria-hidden="true" />;
      case 'smarttv': return <Tv className="w-icon-lg h-icon-lg" aria-hidden="true" />;
      case 'androidtv': return <Monitor className="w-icon-lg h-icon-lg" aria-hidden="true" />;
      case 'dlna': return <Wifi className="w-icon-lg h-icon-lg" aria-hidden="true" />;
      default: return <Smartphone className="w-icon-lg h-icon-lg" aria-hidden="true" />;
    }
  };

  // Toni semantici DS per categoria dispositivo. Niente palette hard-coded.
  const getDeviceTone = (type: DiscoveredDevice['type']) => {
    switch (type) {
      case 'chromecast': return 'text-state-info';
      case 'smarttv': return 'text-state-success';
      case 'androidtv': return 'text-brand-accent';
      case 'dlna': return 'text-state-warning';
      default: return 'text-content-muted';
    }
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      size="sm"
      ariaLabel="Selezione dispositivo cast"
      title={
        <span className="flex items-center gap-3">
          <Cast className="w-icon-md h-icon-md text-state-info" aria-hidden="true" />
          Trasmetti su
        </span>
      }
      description={
        <span className="block truncate">
          <span className="text-content-muted">Contenuto: </span>
          <span className="text-content-primary font-medium">{mediaTitle}</span>
        </span>
      }
      className="max-h-[90vh]"
    >
      <div className="-mx-6 -my-5 flex flex-col">
        {/* Device list */}
        <div className="max-h-[350px] overflow-y-auto">
          {state.isSearching && (
            <div className="px-4 py-3 text-state-info border-b border-subtle bg-state-info/5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Loader2 className="w-icon-md h-icon-md animate-spin flex-shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <span className="text-sm font-medium block truncate">{state.progress.phase || 'Ricerca dispositivi in corso...'}</span>
                    {state.progress.totalHosts > 0 && (
                      <span className="text-xs text-content-muted">{state.progress.scannedHosts}/{state.progress.totalHosts} host verificati</span>
                    )}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleStopSearch}
                  data-initial-focus="true"
                >
                  Annulla
                </Button>
              </div>
              {state.progress.totalHosts > 0 && (
                <div className="mt-3 h-1.5 bg-surface-2 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-state-info transition-all"
                    style={{ width: `${Math.min(100, (state.progress.scannedHosts / state.progress.totalHosts) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {showManualInput && (
            <div className="p-4 border-b border-subtle bg-surface-1">
              <p className="text-sm text-content-muted mb-2">Inserisci l'indirizzo IP del dispositivo:</p>
              <div className="flex gap-2">
                <Input
                  value={manualIP}
                  onChange={(e) => setManualIP(e.target.value)}
                  placeholder="192.168.1.100"
                  onKeyDown={(e) => e.key === 'Enter' && handleManualAdd()}
                  autoFocus
                  className="flex-1"
                  aria-label="Indirizzo IP dispositivo"
                />
                <Button variant="primary" size="md" onClick={handleManualAdd}>
                  Connetti
                </Button>
              </div>
              <p className="text-xs text-content-disabled mt-2">Trova l'IP nelle impostazioni di rete del dispositivo</p>
            </div>
          )}

          {castError && (
            <div className="mx-4 mt-3 rounded-control border border-state-error/30 bg-state-error/10 px-4 py-3 text-sm text-state-error flex items-start gap-2">
              <AlertCircle className="w-icon-sm h-icon-sm text-state-error flex-shrink-0 mt-0.5" aria-hidden="true" />
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
                  className={`tv-focus-dense w-full flex items-center gap-4 px-4 py-3 hover:bg-surface-2 transition-colors text-left ${selectedDevice?.id === device.id ? 'bg-surface-3' : ''} ${isCasting ? 'opacity-50 cursor-not-allowed' : ''}`}
                  data-initial-focus={!state.isSearching ? 'true' : undefined}
                >
                  {device.id === 'manual' ? (
                    <div className="w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center text-content-muted">
                      <Plus className="w-icon-md h-icon-md" aria-hidden="true" />
                    </div>
                  ) : (
                    <div className={`w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center ${getDeviceTone(device.type)}`}>
                      {getDeviceIcon(device.type)}
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <p className="text-content-primary font-medium truncate">{device.name}</p>
                    {device.ip && <p className="text-xs text-content-disabled">{device.ip}</p>}
                  </div>

                  {selectedDevice?.id === device.id && (
                    <div className="flex-shrink-0">
                      {isCasting ? (
                        <Loader2 className="w-icon-md h-icon-md text-state-info animate-spin" aria-hidden="true" />
                      ) : castSuccess ? (
                        <Check className="w-icon-md h-icon-md text-state-success" aria-hidden="true" />
                      ) : null}
                    </div>
                  )}
                </button>
              ))}
            </div>
          ) : !state.isSearching ? (
            <div className="py-8 text-center">
              <WifiOff className="w-12 h-12 text-content-disabled mx-auto mb-3" aria-hidden="true" />
              <p className="text-content-muted">Nessun dispositivo trovato</p>
              <p className="text-sm text-content-disabled mt-1 px-6">Assicurati che i dispositivi siano accesi, sulla stessa rete Wi‑Fi/LAN e che VPN/firewall non blocchino SSDP, DIAL o Chromecast.</p>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-subtle bg-surface-1">
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={state.isSearching}
              leftIcon={Search}
              className={state.isSearching ? '[&_svg]:animate-spin' : ''}
            >
              Aggiorna
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(mediaUrl);
                onCastError?.('URL copiato negli appunti!');
              }}
            >
              Copia URL
            </Button>
          </div>

          <div className="mt-3 p-3 bg-surface-2 rounded-control">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-icon-sm h-icon-sm text-state-warning flex-shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-xs text-content-muted">
                <strong className="text-content-secondary">Suggerimento:</strong> Se il dispositivo non appare, inserisci l'IP manualmente o copia l'URL e incollalo nell'app del dispositivo (VLC, Kodi, IPTV Smarters)
              </p>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default CastDevicePicker;

