
const DB_NAME = 'streamai_db';
const DB_VERSION = 1;
const STORE_API = 'api_responses';
const STORE_IMAGES = 'images';

export const CacheService = {
  dbPromise: null as Promise<IDBDatabase> | null,

  init: async () => {
    if (navigator.storage && navigator.storage.persist) {
      try {
        const isPersisted = await navigator.storage.persist();
        console.log(`[Cache] Storage Persistent Mode: ${isPersisted ? 'Enabled' : 'Disabled/Refused'}`);
        
        if (navigator.storage.estimate) {
            const estimate = await navigator.storage.estimate();
            if (estimate.usage && estimate.quota) {
                const usageMB = (estimate.usage / 1024 / 1024).toFixed(2);
                const quotaMB = (estimate.quota / 1024 / 1024).toFixed(2);
                console.log(`[Cache] Usage: ${usageMB}MB of ${quotaMB}MB`);
            }
        }
      } catch (e) {
        console.warn("[Cache] Failed to request persistence", e);
      }
    }
  },

  openDB: () => {
    if (CacheService.dbPromise) return CacheService.dbPromise;

    CacheService.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_API)) {
          db.createObjectStore(STORE_API); // Key-Value store for JSON
        }
        if (!db.objectStoreNames.contains(STORE_IMAGES)) {
          db.createObjectStore(STORE_IMAGES); // Key-Value store for Blobs
        }
      };

      request.onsuccess = (event) => resolve((event.target as IDBOpenDBRequest).result);
      request.onerror = (event) => reject((event.target as IDBOpenDBRequest).error);
    });

    return CacheService.dbPromise;
  },

  // --- API RESPONSE CACHING ---
  saveApiData: async (key: string, data: any) => {
    const db = await CacheService.openDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_API, 'readwrite');
      const store = tx.objectStore(STORE_API);
      // Add timestamp to invalidate old data if needed
      const payload = { timestamp: Date.now(), data };
      store.put(payload, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  getApiData: async (key: string) => {
    const db = await CacheService.openDB();
    return new Promise<any>((resolve) => {
      const tx = db.transaction(STORE_API, 'readonly');
      const store = tx.objectStore(STORE_API);
      const request = store.get(key);
      request.onsuccess = () => {
          const result = request.result;
          // Simple TTL check (e.g., 24 hours). For now, return data if exists.
          resolve(result ? result.data : null);
      };
      request.onerror = () => resolve(null);
    });
  },

  // --- IMAGE CACHING ---
  saveImage: async (url: string, blob: Blob) => {
    const db = await CacheService.openDB();
    return new Promise<void>((resolve) => { // Don't reject on image save fail, just ignore
      const tx = db.transaction(STORE_IMAGES, 'readwrite');
      const store = tx.objectStore(STORE_IMAGES);
      store.put(blob, url);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve(); 
    });
  },

  getImage: async (url: string): Promise<string | null> => {
    const db = await CacheService.openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_IMAGES, 'readonly');
      const store = tx.objectStore(STORE_IMAGES);
      const request = store.get(url);
      request.onsuccess = () => {
        if (request.result instanceof Blob) {
            resolve(URL.createObjectURL(request.result));
        } else {
            resolve(null);
        }
      };
      request.onerror = () => resolve(null);
    });
  },
  
  hasImage: async (url: string): Promise<boolean> => {
      const db = await CacheService.openDB();
      return new Promise((resolve) => {
          const tx = db.transaction(STORE_IMAGES, 'readonly');
          const store = tx.objectStore(STORE_IMAGES);
          const request = store.count(url);
          request.onsuccess = () => resolve(request.result > 0);
          request.onerror = () => resolve(false);
      });
  },

  clearAll: async () => {
      const db = await CacheService.openDB();
      const tx = db.transaction([STORE_API, STORE_IMAGES], 'readwrite');
      tx.objectStore(STORE_API).clear();
      tx.objectStore(STORE_IMAGES).clear();
  }
};
