/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GEMINI_API_KEY?: string;
  readonly VITE_TMDB_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface NetworkPlaybackStatus {
  deviceId: string;
  channelName: string;
}

interface ElectronAPI {
  updatePlaybackStatus?: (status: unknown) => void;
  onNetworkPlaybackStatus?: (callback: (status: NetworkPlaybackStatus) => void) => () => void;
  onRemoteControlCommand?: (callback: (command: unknown) => void) => () => void;
  onRequestStatusBroadcast?: (callback: () => void) => () => void;
}

