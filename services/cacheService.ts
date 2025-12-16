
const DB_NAME = 'streamai_db';
const DB_VERSION = 1;
const STORE_API = 'api_responses';
const STORE_IMAGES = 'images';

// Cache LRU in memoria per URL delle immagini (evita letture ripetute da IndexedDB)
const IMAGE_URL_CACHE_MAX = 500;
const imageUrlCache = new Map<string, string>(); // url -> objectUrl

// Funzione per gestire LRU cache
const addToUrlCache = (url: string, objectUrl: string) => {
  if (imageUrlCache.size >= IMAGE_URL_CACHE_MAX) {
    // Rimuovi il primo (più vecchio)
    const firstKey = imageUrlCache.keys().next().value;
    if (firstKey) {
      const oldUrl = imageUrlCache.get(firstKey);
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      imageUrlCache.delete(firstKey);
    }
  }
  imageUrlCache.set(url, objectUrl);
};

export const CacheService = {
  dbPromise: null as Promise<IDBDatabase> | null,

  // Statistiche
  stats: {
    hits: 0,
    misses: 0,
    writes: 0
  },

  // Info storage
  storageInfo: {
    persistent: false,
    quota: 0,
    usage: 0
  },

  init: async () => {
    // Richiedi storage persistente (non verrà cancellato dal browser)
    if (navigator.storage) {
      try {
        // Richiedi persistenza - importante per evitare che il browser cancelli i dati
        if (navigator.storage.persist) {
          const isPersisted = await navigator.storage.persist();
          CacheService.storageInfo.persistent = isPersisted;
          console.log(`[Cache] Storage Persistent: ${isPersisted ? '✓ Enabled' : '✗ Disabled'}`);

          if (!isPersisted) {
            console.warn('[Cache] Storage may be cleared by browser under storage pressure');
          }
        }

        // Verifica quota disponibile
        if (navigator.storage.estimate) {
          const estimate = await navigator.storage.estimate();
          const usage = estimate.usage || 0;
          const quota = estimate.quota || 0;

          CacheService.storageInfo.usage = usage;
          CacheService.storageInfo.quota = quota;

          const usageMB = (usage / 1024 / 1024).toFixed(2);
          const quotaMB = (quota / 1024 / 1024).toFixed(2);
          const quotaGB = (quota / 1024 / 1024 / 1024).toFixed(2);
          const percentUsed = quota > 0 ? ((usage / quota) * 100).toFixed(1) : 0;

          console.log(`[Cache] Storage: ${usageMB}MB used of ${quotaGB}GB available (${percentUsed}%)`);

          // Avvisa se lo spazio sta finendo (>80%)
          if (quota > 0 && (usage / quota) > 0.8) {
            console.warn(`[Cache] Storage almost full! ${percentUsed}% used`);
          }
        }
      } catch (e) {
        console.warn("[Cache] Failed to check storage", e);
      }
    }

    // Pre-apri il database
    await CacheService.openDB();
  },

  openDB: () => {
    if (CacheService.dbPromise) return CacheService.dbPromise;

    CacheService.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_API)) {
          db.createObjectStore(STORE_API);
        }
        if (!db.objectStoreNames.contains(STORE_IMAGES)) {
          db.createObjectStore(STORE_IMAGES);
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
          resolve(result ? result.data : null);
      };
      request.onerror = () => resolve(null);
    });
  },

  // --- IMAGE CACHING ---
  saveImage: async (url: string, blob: Blob) => {
    const db = await CacheService.openDB();
    return new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_IMAGES, 'readwrite');
      const store = tx.objectStore(STORE_IMAGES);
      store.put(blob, url);
      tx.oncomplete = () => {
        CacheService.stats.writes++;
        resolve();
      };
      tx.onerror = () => resolve();
    });
  },

  getImage: async (url: string): Promise<string | null> => {
    // Prima controlla cache in memoria
    if (imageUrlCache.has(url)) {
      CacheService.stats.hits++;
      return imageUrlCache.get(url)!;
    }

    const db = await CacheService.openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_IMAGES, 'readonly');
      const store = tx.objectStore(STORE_IMAGES);
      const request = store.get(url);
      request.onsuccess = () => {
        if (request.result instanceof Blob) {
          CacheService.stats.hits++;
          const objectUrl = URL.createObjectURL(request.result);
          addToUrlCache(url, objectUrl);
          resolve(objectUrl);
        } else {
          CacheService.stats.misses++;
          resolve(null);
        }
      };
      request.onerror = () => {
        CacheService.stats.misses++;
        resolve(null);
      };
    });
  },
  
  hasImage: async (url: string): Promise<boolean> => {
    // Prima controlla cache in memoria
    if (imageUrlCache.has(url)) return true;

    const db = await CacheService.openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_IMAGES, 'readonly');
      const store = tx.objectStore(STORE_IMAGES);
      const request = store.count(url);
      request.onsuccess = () => resolve(request.result > 0);
      request.onerror = () => resolve(false);
    });
  },

  // Batch check per più URL (più efficiente)
  hasImages: async (urls: string[]): Promise<Map<string, boolean>> => {
    const results = new Map<string, boolean>();
    const urlsToCheck: string[] = [];

    // Prima controlla cache in memoria
    for (const url of urls) {
      if (imageUrlCache.has(url)) {
        results.set(url, true);
      } else {
        urlsToCheck.push(url);
      }
    }

    if (urlsToCheck.length === 0) return results;

    const db = await CacheService.openDB();

    // Usa una singola transazione per tutti i check
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_IMAGES, 'readonly');
      const store = tx.objectStore(STORE_IMAGES);
      let pending = urlsToCheck.length;

      for (const url of urlsToCheck) {
        const request = store.count(url);
        request.onsuccess = () => {
          results.set(url, request.result > 0);
          pending--;
          if (pending === 0) resolve(results);
        };
        request.onerror = () => {
          results.set(url, false);
          pending--;
          if (pending === 0) resolve(results);
        };
      }
    });
  },

  clearAll: async () => {
    const db = await CacheService.openDB();
    const tx = db.transaction([STORE_API, STORE_IMAGES], 'readwrite');
    tx.objectStore(STORE_API).clear();
    tx.objectStore(STORE_IMAGES).clear();

    // Pulisci anche cache in memoria
    for (const objectUrl of imageUrlCache.values()) {
      URL.revokeObjectURL(objectUrl);
    }
    imageUrlCache.clear();

    CacheService.stats = { hits: 0, misses: 0, writes: 0 };
  },

  // Pulisci solo cache immagini
  clearImages: async () => {
    const db = await CacheService.openDB();
    const tx = db.transaction(STORE_IMAGES, 'readwrite');
    tx.objectStore(STORE_IMAGES).clear();

    for (const objectUrl of imageUrlCache.values()) {
      URL.revokeObjectURL(objectUrl);
    }
    imageUrlCache.clear();
  },

  // Ottieni info storage aggiornate
  getStorageInfo: async () => {
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        CacheService.storageInfo.usage = estimate.usage || 0;
        CacheService.storageInfo.quota = estimate.quota || 0;
      } catch (e) {
        // Ignora errori
      }
    }

    return {
      persistent: CacheService.storageInfo.persistent,
      usageMB: (CacheService.storageInfo.usage / 1024 / 1024).toFixed(2),
      quotaGB: (CacheService.storageInfo.quota / 1024 / 1024 / 1024).toFixed(2),
      percentUsed: CacheService.storageInfo.quota > 0
        ? ((CacheService.storageInfo.usage / CacheService.storageInfo.quota) * 100).toFixed(1)
        : 0
    };
  },

  // Conta immagini in cache
  countImages: async (): Promise<number> => {
    const db = await CacheService.openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_IMAGES, 'readonly');
      const store = tx.objectStore(STORE_IMAGES);
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(0);
    });
  },

  getStats: async () => {
    const storageInfo = await CacheService.getStorageInfo();
    const imageCount = await CacheService.countImages();

    return {
      ...CacheService.stats,
      memCacheSize: imageUrlCache.size,
      hitRate: CacheService.stats.hits + CacheService.stats.misses > 0
        ? Math.round(CacheService.stats.hits / (CacheService.stats.hits + CacheService.stats.misses) * 100)
        : 0,
      storage: storageInfo,
      totalImages: imageCount
    };
  }
};
