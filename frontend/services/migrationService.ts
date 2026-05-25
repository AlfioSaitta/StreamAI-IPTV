import { host } from './hostBridge';
import { ProfileService } from './profileService';

export interface LegacyData {
  profiles?: string;
  localStorage?: Record<string, string>;
  indexedDb?: Record<string, string>;
}

export const MigrationService = {
  checkAndMigrate: async (): Promise<boolean> => {
    try {
      if (!host?.HasLegacyData) return false;
      
      const hasLegacy = await host.HasLegacyData();
      if (!hasLegacy) return false;

      // Se abbiamo già profili, non sovrascrivere automaticamente?
      // Forse è meglio chiedere all'utente, ma per ora facciamo un controllo semplice.
      const currentProfiles = ProfileService.getAll();
      if (currentProfiles.length > 0) {
        console.log('[Migration] Legacy data found but current profiles exist. Skipping auto-migration.');
        return false;
      }

      console.log('[Migration] Legacy data detected. Starting extraction...');
      const jsonData = await host.GetLegacyData();
      if (!jsonData) return false;

      const data: LegacyData = JSON.parse(jsonData);

      if (data.profiles) {
        console.log('[Migration] Migrating profiles...');
        localStorage.setItem('streamai_profiles', data.profiles);
        // Forza il ricaricamento dei profili se necessario, 
        // ma App.tsx solitamente li legge al boot.
      }

      if (data.localStorage) {
        console.log('[Migration] Migrating extra local storage keys...');
        for (const [key, value] of Object.entries(data.localStorage)) {
          if (!localStorage.getItem(key)) {
            localStorage.setItem(key, value);
          }
        }
      }

      console.log('[Migration] Data migration completed successfully.');
      return true;
    } catch (e) {
      console.error('[Migration] Migration failed:', e);
      return false;
    }
  }
};
