
const DB_NAME = 'streamai_db';
const DB_VERSION = 1;
const STORE_API = 'api_responses';
const STORE_IMAGES = 'images';

const IMAGE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const IMAGE_CACHE_MAX_ENTRIES = 1500;
const IMAGE_CACHE_MAX_BYTES = 512 * 1024 * 1024;
const IMAGE_CACHE_PRESSURE_RATIO = 0.85;

interface ApiCacheOptions {
  maxAgeMs?: number;
}

interface ImageCacheRecord {
  blob: Blob;
  timestamp: number;
  lastAccessed: number;
  size: number;
  type?: string;
}

// Cache LRU in memoria per URL delle immagini (evita letture ripetute da IndexedDB)
const IMAGE_URL_CACHE_MAX = 500;
const imageUrlCache = new Map<string, string>(); // url -> objectUrl
let lastImageCleanupAt = 0;

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

const isImageCacheRecord = (value: unknown): value is ImageCacheRecord => {
  return Boolean(value && typeof value === 'object' && (value as ImageCacheRecord).blob instanceof Blob);
};

// noinspection JSUnusedGlobalSymbols
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
    CacheService.cleanupOldImages().catch(e => console.warn('[Cache] Image cleanup failed', e));
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

  getApiData: async (key: string, options: ApiCacheOptions = {}) => {
    const db = await CacheService.openDB();
    return new Promise<any>((resolve) => {
      const tx = db.transaction(STORE_API, options.maxAgeMs ? 'readwrite' : 'readonly');
      const store = tx.objectStore(STORE_API);
      const request = store.get(key);
      request.onsuccess = () => {
          const result = request.result;
          if (!result) {
            resolve(null);
            return;
          }

          if (options.maxAgeMs && Date.now() - Number(result.timestamp || 0) > options.maxAgeMs) {
            store.delete(key);
            resolve(null);
            return;
          }

          resolve(result.data ?? null);
      };
      request.onerror = () => resolve(null);
    });
  },

  pruneApiCache: async (prefix: string, maxEntries: number) => {
    const db = await CacheService.openDB();
    return new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_API, 'readwrite');
      const store = tx.objectStore(STORE_API);
      const request = store.getAllKeys();
      request.onsuccess = () => {
        const keys = request.result.filter((key): key is string => typeof key === 'string' && key.startsWith(prefix));
        if (keys.length <= maxEntries) {
          resolve();
          return;
        }

        const entries: Array<{ key: string; timestamp: number }> = [];
        let pending = keys.length;
        keys.forEach((key) => {
          const itemRequest = store.get(key);
          itemRequest.onsuccess = () => {
            entries.push({ key, timestamp: Number(itemRequest.result?.timestamp || 0) });
            pending--;
            if (pending === 0) {
              entries
                .sort((a, b) => a.timestamp - b.timestamp)
                .slice(0, Math.max(0, entries.length - maxEntries))
                .forEach(entry => store.delete(entry.key));
              resolve();
            }
          };
          itemRequest.onerror = () => {
            pending--;
            if (pending === 0) resolve();
          };
        });
      };
      request.onerror = () => resolve();
    });
  },

  clearApiByPrefix: async (prefixes: string | string[]) => {
    const prefixList = Array.isArray(prefixes) ? prefixes : [prefixes];
    const db = await CacheService.openDB();
    return new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_API, 'readwrite');
      const store = tx.objectStore(STORE_API);
      const request = store.getAllKeys();
      request.onsuccess = () => {
        request.result
          .filter((key): key is string => typeof key === 'string' && prefixList.some(prefix => key.startsWith(prefix)))
          .forEach(key => store.delete(key));
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  },

  // --- IMAGE CACHING ---
  saveImage: async (url: string, blob: Blob) => {
    if (!blob || blob.size <= 0) return;

    if (CacheService.storageInfo.quota > 0 && CacheService.storageInfo.usage / CacheService.storageInfo.quota > IMAGE_CACHE_PRESSURE_RATIO) {
      await CacheService.cleanupOldImages({ aggressive: true });
    }

    if (Date.now() - lastImageCleanupAt > 5 * 60 * 1000) {
      lastImageCleanupAt = Date.now();
      await CacheService.cleanupOldImages();
    }

    const db = await CacheService.openDB();
    return new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_IMAGES, 'readwrite');
      const store = tx.objectStore(STORE_IMAGES);
      const payload: ImageCacheRecord = {
        blob,
        timestamp: Date.now(),
        lastAccessed: Date.now(),
        size: blob.size,
        type: blob.type
      };
      store.put(payload, url);
      tx.oncomplete = () => {
        CacheService.stats.writes++;
        resolve();
      };
      tx.onerror = () => {
        console.warn('[Cache] Image save failed, storage may be full:', tx.error);
        CacheService.cleanupOldImages({ aggressive: true }).finally(resolve);
      };
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
      const tx = db.transaction(STORE_IMAGES, 'readwrite');
      const store = tx.objectStore(STORE_IMAGES);
      const request = store.get(url);
      request.onsuccess = () => {
        const now = Date.now();
        const result = request.result;
        const record = result instanceof Blob
          ? { blob: result, timestamp: now, lastAccessed: now, size: result.size, type: result.type }
          : isImageCacheRecord(result)
            ? result
            : null;

        if (record?.blob instanceof Blob) {
          if (now - Number(record.timestamp || 0) > IMAGE_CACHE_TTL_MS) {
            store.delete(url);
            CacheService.stats.misses++;
            resolve(null);
            return;
          }

          CacheService.stats.hits++;
          store.put({ ...record, lastAccessed: now }, url);
          const objectUrl = URL.createObjectURL(record.blob);
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

  cleanupOldImages: async (options: { aggressive?: boolean } = {}) => {
    const db = await CacheService.openDB();
    return new Promise<{ deleted: number; freedBytes: number }>((resolve) => {
      const tx = db.transaction(STORE_IMAGES, 'readwrite');
      const store = tx.objectStore(STORE_IMAGES);
      const request = store.getAllKeys();

      request.onsuccess = () => {
        const keys = request.result.filter((key): key is string => typeof key === 'string');
        if (keys.length === 0) {
          resolve({ deleted: 0, freedBytes: 0 });
          return;
        }

        const entries: Array<{ key: string; timestamp: number; lastAccessed: number; size: number }> = [];
        let pending = keys.length;
        let deleted = 0;
        let freedBytes = 0;
        const now = Date.now();

        const finish = () => {
          const maxEntries = options.aggressive ? Math.floor(IMAGE_CACHE_MAX_ENTRIES * 0.65) : IMAGE_CACHE_MAX_ENTRIES;
          const maxBytes = options.aggressive ? Math.floor(IMAGE_CACHE_MAX_BYTES * 0.65) : IMAGE_CACHE_MAX_BYTES;
          let totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
          const candidates = entries
            .filter(entry => now - entry.timestamp > IMAGE_CACHE_TTL_MS || entries.length > maxEntries || totalBytes > maxBytes)
            .sort((a, b) => a.lastAccessed - b.lastAccessed || a.timestamp - b.timestamp);

          for (const entry of candidates) {
            if (now - entry.timestamp <= IMAGE_CACHE_TTL_MS && entries.length - deleted <= maxEntries && totalBytes <= maxBytes) break;
            store.delete(entry.key);
            const objectUrl = imageUrlCache.get(entry.key);
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            imageUrlCache.delete(entry.key);
            deleted++;
            freedBytes += entry.size;
            totalBytes -= entry.size;
          }
          resolve({ deleted, freedBytes });
        };

        keys.forEach((key) => {
          const itemRequest = store.get(key);
          itemRequest.onsuccess = () => {
            const value = itemRequest.result;
            if (value instanceof Blob) {
              entries.push({ key, timestamp: 0, lastAccessed: 0, size: value.size });
            } else if (isImageCacheRecord(value)) {
              entries.push({
                key,
                timestamp: Number(value.timestamp || 0),
                lastAccessed: Number(value.lastAccessed || value.timestamp || 0),
                size: Number(value.size || value.blob.size || 0)
              });
            }
            pending--;
            if (pending === 0) finish();
          };
          itemRequest.onerror = () => {
            pending--;
            if (pending === 0) finish();
          };
        });
      };
      request.onerror = () => resolve({ deleted: 0, freedBytes: 0 });
    });
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

  getImageCacheInfo: async () => {
    const db = await CacheService.openDB();
    return new Promise<{ count: number; totalBytes: number; limitEntries: number; limitBytes: number; ttlDays: number }>((resolve) => {
      const tx = db.transaction(STORE_IMAGES, 'readonly');
      const store = tx.objectStore(STORE_IMAGES);
      const request = store.getAll();
      request.onsuccess = () => {
        const values = request.result;
        const totalBytes = values.reduce((sum, value) => {
          if (value instanceof Blob) return sum + value.size;
          if (isImageCacheRecord(value)) return sum + Number(value.size || value.blob.size || 0);
          return sum;
        }, 0);
        resolve({
          count: values.length,
          totalBytes,
          limitEntries: IMAGE_CACHE_MAX_ENTRIES,
          limitBytes: IMAGE_CACHE_MAX_BYTES,
          ttlDays: Math.round(IMAGE_CACHE_TTL_MS / 24 / 60 / 60 / 1000)
        });
      };
      request.onerror = () => resolve({ count: 0, totalBytes: 0, limitEntries: IMAGE_CACHE_MAX_ENTRIES, limitBytes: IMAGE_CACHE_MAX_BYTES, ttlDays: 30 });
    });
  },

  getStats: async () => {
    const storageInfo = await CacheService.getStorageInfo();
    const imageCache = await CacheService.getImageCacheInfo();

    return {
      ...CacheService.stats,
      memCacheSize: imageUrlCache.size,
      hitRate: CacheService.stats.hits + CacheService.stats.misses > 0
        ? Math.round(CacheService.stats.hits / (CacheService.stats.hits + CacheService.stats.misses) * 100)
        : 0,
      storage: storageInfo,
      totalImages: imageCache.count,
      imageBytesMB: (imageCache.totalBytes / 1024 / 1024).toFixed(2),
      imageLimitMB: Math.round(imageCache.limitBytes / 1024 / 1024),
      imageLimitEntries: imageCache.limitEntries,
      imageTtlDays: imageCache.ttlDays
    };
  }
};
