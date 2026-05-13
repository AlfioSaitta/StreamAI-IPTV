
import { Profile, XtreamCredentials, WatchHistoryItem, ProfilePreferences } from '../types.ts';

const STORAGE_KEY = 'streamai_profiles';

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
  autoNextEpisodeEnabled: true
};

export const ProfileService = {
  getAll: (): Profile[] => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const parsed = stored ? JSON.parse(stored) : [];
      return Array.isArray(parsed) 
        ? parsed.map((p: Profile) => ({
            ...p,
            history: p.history || [],
            watchlist: p.watchlist || [],
            preferences: {
              ...DEFAULT_PREFERENCES,
              ...(p.preferences || {})
            }
        }))
        : [];
    } catch (e) {
      return [];
    }
  },

  saveAll: (profiles: Profile[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
  },

  create: (name: string): Profile => {
    const profiles = ProfileService.getAll();
    const colors = ['#8b5cf6', '#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#ef4444'];
    const newProfile: Profile = {
      id: crypto.randomUUID(),
      name,
      color: colors[profiles.length % colors.length],
      xtreamCreds: null,
      history: [],
      watchlist: [],
      preferences: { ...DEFAULT_PREFERENCES }
    };
    profiles.push(newProfile);
    ProfileService.saveAll(profiles);
    return newProfile;
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
      ProfileService.saveAll(profiles);
    }
    return profiles[index]; // Return updated profile
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
      const profiles = ProfileService.getAll();
      const pIndex = profiles.findIndex(p => p.id === profileId);
      if (pIndex !== -1) {
          const history = profiles[pIndex].history;
          const hIndex = history.findIndex(h => h.channelId === channelId);
          
          if (hIndex !== -1) {
              history[hIndex].progress = progress;
              history[hIndex].duration = duration;
              history[hIndex].timestamp = Date.now(); // Update last watched time
              ProfileService.saveAll(profiles);
              return profiles[pIndex];
          }
      }
      return null;
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

  updateProfile: (profileId: string, updates: { name?: string; color?: string }): Profile | null => {
      const profiles = ProfileService.getAll();
      const index = profiles.findIndex(p => p.id === profileId);
      if (index !== -1) {
          if (updates.name) profiles[index].name = updates.name;
          if (updates.color) profiles[index].color = updates.color;
          ProfileService.saveAll(profiles);
          return profiles[index];
      }
      return null;
  }
};
