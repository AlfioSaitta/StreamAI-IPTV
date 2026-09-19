
import { Profile, XtreamCredentials, XtreamServer, WatchHistoryItem, ProfilePreferences } from '../types.ts';
import { pickDefaultAvatarFor } from './avatars.ts';

const STORAGE_KEY = 'streamai_profiles';

/**
 * Intervallo di coalescing delle scritture su localStorage.
 *
 * `updateProgress` e' chiamato a ogni aggiornamento di posizione del player
 * (~1 Hz) e ogni scrittura costa un `JSON.parse` + un `JSON.stringify` + un
 * `localStorage.setItem` **sincrono** dell'intero blob profili sul main thread.
 * Con una history di 100 elementi sono decine di KB serialize/deserializzate al
 * secondo durante la riproduzione, con jank su seek e OSD.
 */
const WRITE_COALESCE_MS = 5_000;

/**
 * Cache in memoria dei profili. `null` = non ancora caricata.
 *
 * Serve a evitare che ogni lettura ripaghi il `JSON.parse` + `migrateProfile`
 * dell'intero blob.
 */
let profilesCache: Profile[] | null = null;
/** Handle del flush differito, se armato. */
let flushTimer: ReturnType<typeof setTimeout> | null = null;
/** True se la cache contiene modifiche non ancora persistite. */
let pendingWrite = false;

/** Copia superficiale profonda-abbastanza: i mutatori sostituiscono i campi. */
const cloneProfile = (profile: Profile): Profile => ({
  ...profile,
  history: [...profile.history],
  watchlist: [...profile.watchlist],
  // `Profile.preferences` è OPZIONALE: `{ ...profile.preferences }` da solo
  // produrrebbe proprietà opzionali (`language?: string | undefined`), non
  // assegnabili a `ProfilePreferences` che le vuole obbligatorie. I default
  // sono già applicati in `loadProfiles`; qui servono anche a soddisfare il tipo.
  preferences: { ...DEFAULT_PREFERENCES, ...profile.preferences },
});

/** Carica i profili (una volta) da localStorage, applicando le migrazioni. */
const loadProfiles = (): Profile[] => {
  if (profilesCache) return profilesCache;

  let loaded: Profile[] = [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    if (Array.isArray(parsed)) {
      loaded = parsed.map((p: Profile) =>
        migrateProfile({
          ...p,
          history: p.history || [],
          watchlist: p.watchlist || [],
          preferences: {
            ...DEFAULT_PREFERENCES,
            ...(p.preferences || {}),
          },
        }),
      );
    }
  } catch (err) {
    console.error('[ProfileService] failed to read profiles, starting empty:', err);
    loaded = [];
  }

  profilesCache = loaded;
  return loaded;
};

/** Scrive subito la cache su localStorage (se ci sono modifiche pendenti). */
const persistNow = (): void => {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!pendingWrite || !profilesCache) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profilesCache));
    pendingWrite = false;
  } catch (err) {
    // Il flush differito non deve perdere i dati silenziosamente: la cache
    // resta "sporca" e il prossimo flush ritenta.
    console.error('[ProfileService] failed to persist profiles:', err);
  }
};

/** Pianifica un flush differito, se non ce n'e' gia' uno armato. */
const scheduleFlush = (): void => {
  pendingWrite = true;
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    persistNow();
  }, WRITE_COALESCE_MS);
};

// Rete di sicurezza per il coalescing: se la finestra viene nascosta o chiusa
// entro la finestra di 5s (chiusura app, cambio scheda, sospensione), gli
// ultimi avanzamenti verrebbero persi. Persistiamo subito in quel caso.
if (typeof window !== 'undefined') {
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persistNow();
  });
  window.addEventListener('pagehide', () => persistNow());
}

export const DEFAULT_PREFERENCES: ProfilePreferences = {
  language: 'it',
  subtitleLanguage: 'it',
  aiCaching: true,
  debugOverlay: false,
  theme: 'dark',
  contentAutoRefreshEnabled: false,
  contentAutoRefreshIntervalMinutes: 360,
  contentLastRefreshAt: undefined,
  contentLastRefreshError: undefined,
  continueWatchingCompletedThreshold: 0.95,
  continueWatchingMoviesEnabled: false,
  continueWatchingSeriesEnabled: true,
  hideAiUnavailableHint: false,
  hasSeenShortcutsCheatsheet: false,
  autoNextEpisodeEnabled: true,
  fontScale: 'md'
};

/**
 * Genera un nome amichevole per un server a partire dall'host dell'URL,
 * usato come fallback se l'utente non ne fornisce uno esplicito.
 */
function deriveServerName(url: string, fallback = 'Server'): string {
  try {
    const u = new URL(url);
    return u.hostname || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Migrazione idempotente: se un profilo ha `xtreamCreds` ma nessun
 * `servers`, sintetizza un singolo server e lo marca come attivo.
 * Quando l'utente collega server aggiuntivi, `xtreamCreds` viene mantenuto
 * allineato al server attivo per retro-compatibilità con il resto del
 * codice (componenti, servizi Xtream, hook health-check).
 */
function migrateProfile(p: Profile): Profile {
  const servers = Array.isArray(p.servers) ? p.servers : [];
  const needsSeed = servers.length === 0 && p.xtreamCreds;
  if (needsSeed) {
    const seeded: XtreamServer = {
      id: crypto.randomUUID(),
      name: deriveServerName(p.xtreamCreds!.url, 'Server'),
      url: p.xtreamCreds!.url,
      username: p.xtreamCreds!.username,
      password: p.xtreamCreds!.password,
      createdAt: Date.now(),
    };
    return { ...p, servers: [seeded], activeServerId: seeded.id };
  }
  // Se ho già servers ma activeServerId punta a qualcosa di obsoleto,
  // ri-allineo al primo disponibile.
  if (servers.length > 0 && !servers.some((s) => s.id === p.activeServerId)) {
    const first = servers[0];
    return {
      ...p,
      activeServerId: first.id,
      xtreamCreds: { url: first.url, username: first.username, password: first.password },
    };
  }
  return p;
}

export const ProfileService = {
  /**
   * Ritorna i profili.
   *
   * Le letture non toccano localStorage (la cache in memoria e' popolata una
   * volta) e ritornano copie, cosi' una mutazione da parte del chiamante non
   * corrompe la cache: chi modifica deve poi chiamare `saveAll` (e' il
   * contratto gia' in uso in tutti i mutatori).
   */
  getAll: (): Profile[] => loadProfiles().map(cloneProfile),

  /**
   * Sostituisce l'intero set di profili e persiste SUBITO.
   *
   * La scrittura immediata e' voluta: e' un'operazione esplicita
   * (creazione/cancellazione/cambio credenziali), dove attendere il flush
   * differito rischierebbe di perdere la modifica in caso di chiusura.
   */
  saveAll: (profiles: Profile[]) => {
    profilesCache = profiles;
    pendingWrite = true;
    persistNow();
  },

  create: (
    name: string,
    options: {
      color?: string;
      avatar?: string;
      preferences?: Partial<ProfilePreferences>;
      playlistUrl?: string;
      xtreamCreds?: XtreamCredentials | null;
    } = {},
  ): Profile => {
    const profiles = ProfileService.getAll();
    const colors = ['#8b5cf6', '#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#ef4444'];
    const newProfile: Profile = {
      id: crypto.randomUUID(),
      name,
      color: options.color ?? colors[profiles.length % colors.length],
      avatar: options.avatar ?? pickDefaultAvatarFor(profiles.length),
      xtreamCreds: options.xtreamCreds ?? null,
      playlistUrl: options.playlistUrl?.trim() || undefined,
      history: [],
      watchlist: [],
      preferences: { ...DEFAULT_PREFERENCES, ...(options.preferences ?? {}) },
    };
    // Se l'utente ha già fornito credenziali Xtream nell'onboarding (C.2),
    // sintetizziamo subito il server attivo per coerenza con il flusso
    // multi-server (no migrazione lazy a runtime).
    if (newProfile.xtreamCreds) {
      const seeded: XtreamServer = {
        id: crypto.randomUUID(),
        name: deriveServerName(newProfile.xtreamCreds.url, 'Server'),
        url: newProfile.xtreamCreds.url,
        username: newProfile.xtreamCreds.username,
        password: newProfile.xtreamCreds.password,
        createdAt: Date.now(),
      };
      newProfile.servers = [seeded];
      newProfile.activeServerId = seeded.id;
    }
    profiles.push(newProfile);
    ProfileService.saveAll(profiles);
    return newProfile;
  },

  /**
   * Aggiorna l'URL della playlist M3U remota (C.2). Passando `null` o
   * stringa vuota la rimuove. Non tocca `xtreamCreds` né i server.
   */
  updatePlaylistUrl: (profileId: string, url: string | null): Profile | null => {
    const profiles = ProfileService.getAll();
    const index = profiles.findIndex((p) => p.id === profileId);
    if (index === -1) return null;
    const trimmed = (url ?? '').trim();
    profiles[index].playlistUrl = trimmed || undefined;
    ProfileService.saveAll(profiles);
    return profiles[index];
  },

  delete: (id: string) => {
    const profiles = ProfileService.getAll().filter(p => p.id !== id);
    ProfileService.saveAll(profiles);
  },

  getWatchlist: (profileId: string): string[] => {
    const profiles = ProfileService.getAll();
    const profile = profiles.find(p => p.id === profileId);
    return profile?.watchlist || [];
  },

  toggleWatchlist: (profileId: string, channelId: string) => {
    const profiles = ProfileService.getAll();
    const index = profiles.findIndex(p => p.id === profileId);
    if (index !== -1) {
      const watchlist = profiles[index].watchlist || [];
      const exists = watchlist.includes(channelId);
      profiles[index].watchlist = exists
        ? watchlist.filter(id => id !== channelId)
        : [channelId, ...watchlist].slice(0, 200);
      ProfileService.saveAll(profiles);
      return profiles[index];
    }
    return null;
  },

  updateCredentials: (profileId: string, creds: XtreamCredentials | null) => {
    const profiles = ProfileService.getAll();
    const index = profiles.findIndex(p => p.id === profileId);
    if (index !== -1) {
      profiles[index].xtreamCreds = creds;
      // Mantieni sincronizzato il server attivo se esiste.
      if (creds && profiles[index].activeServerId && Array.isArray(profiles[index].servers)) {
        const sIdx = profiles[index].servers!.findIndex(
          (s) => s.id === profiles[index].activeServerId,
        );
        if (sIdx !== -1) {
          profiles[index].servers![sIdx] = {
            ...profiles[index].servers![sIdx],
            url: creds.url,
            username: creds.username,
            password: creds.password,
          };
        }
      }
      ProfileService.saveAll(profiles);
    }
    return profiles[index]; // Return updated profile
  },

  // === Multi-server (2026-05-14) =====================================

  /** Elenco completo dei server del profilo (vuoto se non configurato). */
  getServers: (profileId: string): XtreamServer[] => {
    const profile = ProfileService.getAll().find((p) => p.id === profileId);
    return profile?.servers ? [...profile.servers] : [];
  },

  /** Ritorna l'id del server attualmente attivo (o `null`). */
  getActiveServerId: (profileId: string): string | null => {
    const profile = ProfileService.getAll().find((p) => p.id === profileId);
    return profile?.activeServerId ?? null;
  },

  /**
   * Aggiunge un nuovo server al profilo. Se è il primo viene marcato come
   * attivo (e specchiato su `xtreamCreds`). Ritorna il profilo aggiornato
   * e il server creato.
   */
  addServer: (
    profileId: string,
    input: Omit<XtreamServer, 'id' | 'createdAt'> | XtreamCredentials,
  ): { profile: Profile | null; server: XtreamServer | null } => {
    const profiles = ProfileService.getAll();
    const index = profiles.findIndex((p) => p.id === profileId);
    if (index === -1) return { profile: null, server: null };
    const url = input.url.trim();
    const username = input.username.trim();
    const password = input.password.trim();
    const name = (('name' in input && input.name) || '').trim() || deriveServerName(url);
    const server: XtreamServer = {
      id: crypto.randomUUID(),
      name,
      url,
      username,
      password,
      createdAt: Date.now(),
    };
    const servers = Array.isArray(profiles[index].servers) ? [...profiles[index].servers!] : [];
    servers.push(server);
    profiles[index].servers = servers;
    // Se non c'è ancora un server attivo, attivo questo automaticamente.
    if (!profiles[index].activeServerId) {
      profiles[index].activeServerId = server.id;
      profiles[index].xtreamCreds = { url, username, password };
    }
    ProfileService.saveAll(profiles);
    return { profile: profiles[index], server };
  },

  /** Aggiorna nome o credenziali di un server esistente. */
  updateServer: (
    profileId: string,
    serverId: string,
    updates: Partial<Omit<XtreamServer, 'id' | 'createdAt'>>,
  ): Profile | null => {
    const profiles = ProfileService.getAll();
    const pIdx = profiles.findIndex((p) => p.id === profileId);
    if (pIdx === -1 || !Array.isArray(profiles[pIdx].servers)) return null;
    const sIdx = profiles[pIdx].servers!.findIndex((s) => s.id === serverId);
    if (sIdx === -1) return null;
    const prev = profiles[pIdx].servers![sIdx];
    const next: XtreamServer = {
      ...prev,
      ...updates,
      name: (updates.name ?? prev.name)?.trim() || deriveServerName(updates.url ?? prev.url),
      url: (updates.url ?? prev.url).trim(),
      username: (updates.username ?? prev.username).trim(),
      password: (updates.password ?? prev.password).trim(),
    };
    profiles[pIdx].servers![sIdx] = next;
    // Se è quello attivo, riallinea `xtreamCreds`.
    if (profiles[pIdx].activeServerId === serverId) {
      profiles[pIdx].xtreamCreds = {
        url: next.url,
        username: next.username,
        password: next.password,
      };
    }
    ProfileService.saveAll(profiles);
    return profiles[pIdx];
  },

  /**
   * Rimuove un server. Se era quello attivo, attiva automaticamente il
   * primo rimanente (o azzera tutto se la lista resta vuota).
   */
  deleteServer: (profileId: string, serverId: string): Profile | null => {
    const profiles = ProfileService.getAll();
    const pIdx = profiles.findIndex((p) => p.id === profileId);
    if (pIdx === -1 || !Array.isArray(profiles[pIdx].servers)) return null;
    const wasActive = profiles[pIdx].activeServerId === serverId;
    profiles[pIdx].servers = profiles[pIdx].servers!.filter((s) => s.id !== serverId);
    if (wasActive) {
      const next = profiles[pIdx].servers![0];
      if (next) {
        profiles[pIdx].activeServerId = next.id;
        profiles[pIdx].xtreamCreds = {
          url: next.url,
          username: next.username,
          password: next.password,
        };
      } else {
        profiles[pIdx].activeServerId = undefined;
        profiles[pIdx].xtreamCreds = null;
      }
    }
    ProfileService.saveAll(profiles);
    return profiles[pIdx];
  },

  /** Marca un server come attivo (e specchia su `xtreamCreds`). */
  setActiveServer: (profileId: string, serverId: string): Profile | null => {
    const profiles = ProfileService.getAll();
    const pIdx = profiles.findIndex((p) => p.id === profileId);
    if (pIdx === -1 || !Array.isArray(profiles[pIdx].servers)) return null;
    const server = profiles[pIdx].servers!.find((s) => s.id === serverId);
    if (!server) return null;
    profiles[pIdx].activeServerId = server.id;
    profiles[pIdx].xtreamCreds = {
      url: server.url,
      username: server.username,
      password: server.password,
    };
    ProfileService.saveAll(profiles);
    return profiles[pIdx];
  },

  addToHistory: (profileId: string, item: Omit<WatchHistoryItem, 'timestamp'>) => {
    const profiles = ProfileService.getAll();
    const index = profiles.findIndex(p => p.id === profileId);
    if (index !== -1) {
      const history = profiles[index].history;
      // Check if exists to preserve progress if we are just "selecting" it again
      const existing = history.find(h => h.channelId === item.channelId);
      
      const filtered = history.filter(h => h.channelId !== item.channelId);
      
      // Merge existing progress if available
      const newItem: WatchHistoryItem = { 
          ...item, 
          timestamp: Date.now(),
          progress: existing?.progress || 0
      };

      filtered.unshift(newItem);
      profiles[index].history = filtered.slice(0, 100); // Limit history size
      ProfileService.saveAll(profiles);
      return profiles[index];
    }
    return null;
  },
  
  // Specific method to update progress without re-ordering the whole list constantly
  updateProgress: (profileId: string, channelId: string, progress: number, duration: number) => {
      // Lavora direttamente sulla cache (non su una copia) e pianifica un flush
      // differito: questo metodo e' chiamato a ogni tick di posizione del player
      // (~1 Hz), quindi una scrittura sincrona per tick era il caso peggiore.
      const profiles = loadProfiles();
      const pIndex = profiles.findIndex(p => p.id === profileId);
      if (pIndex === -1) return null;

      const history = profiles[pIndex].history;
      const hIndex = history.findIndex(h => h.channelId === channelId);
      if (hIndex === -1) return null;

      history[hIndex].progress = progress;
      history[hIndex].duration = duration;
      history[hIndex].timestamp = Date.now(); // Update last watched time

      scheduleFlush();
      return cloneProfile(profiles[pIndex]);
  },
  
  getHistory: (profileId: string): WatchHistoryItem[] => {
      const profiles = ProfileService.getAll();
      const profile = profiles.find(p => p.id === profileId);
      return profile ? profile.history : [];
  },

  updatePreferences: (profileId: string, preferences: Partial<ProfilePreferences>): Profile | null => {
      const profiles = ProfileService.getAll();
      const index = profiles.findIndex(p => p.id === profileId);
      if (index !== -1) {
          profiles[index].preferences = {
              ...DEFAULT_PREFERENCES,
              ...(profiles[index].preferences || {}),
              ...preferences
          };
          ProfileService.saveAll(profiles);
          return profiles[index];
      }
      return null;
  },

  getPreferences: (profileId: string): ProfilePreferences => {
      const profiles = ProfileService.getAll();
      const profile = profiles.find(p => p.id === profileId);
      return profile?.preferences || DEFAULT_PREFERENCES;
  },

  updateProfile: (profileId: string, updates: { name?: string; color?: string; avatar?: string }): Profile | null => {
      const profiles = ProfileService.getAll();
      const index = profiles.findIndex(p => p.id === profileId);
      if (index !== -1) {
          if (updates.name) profiles[index].name = updates.name;
          if (updates.color) profiles[index].color = updates.color;
          if (updates.avatar) profiles[index].avatar = updates.avatar;
          ProfileService.saveAll(profiles);
          return profiles[index];
      }
      return null;
  }
};
