
import { CacheService } from './cacheService.ts';
import { Channel } from '../types.ts';

// Concurrency limit to avoid choking the network
const MAX_CONCURRENT_DOWNLOADS = 4;

export const DownloadManager = {
  queue: [] as string[],
  processing: 0,
  active: false,

  startBackgroundDownload: (channels: Channel[]) => {
    if (DownloadManager.active) return; // Already running
    DownloadManager.active = true;

    // 1. Extract images
    const imagesToFetch = channels
      .filter(c => c.logo && c.logo.startsWith('http'))
      .map(c => c.logo as string);

    // 2. Add to queue (Deduplicate)
    const unique = [...new Set(imagesToFetch)];
    DownloadManager.queue = unique;
    
    // 3. Start processing
    DownloadManager.processQueue();
  },

  processQueue: async () => {
    if (DownloadManager.queue.length === 0) {
      DownloadManager.active = false;
      return;
    }

    // Fill slots up to MAX_CONCURRENT
    while (DownloadManager.processing < MAX_CONCURRENT_DOWNLOADS && DownloadManager.queue.length > 0) {
        const url = DownloadManager.queue.shift();
        if (url) {
            DownloadManager.processing++;
            DownloadManager.downloadAndCache(url).finally(() => {
                DownloadManager.processing--;
                DownloadManager.processQueue(); // Loop
            });
        }
    }
  },

  downloadAndCache: async (url: string) => {
    try {
        // Check if exists first to save bandwidth
        const exists = await CacheService.hasImage(url);
        if (exists) return;

        const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (!response.ok) return;
        
        const blob = await response.blob();
        await CacheService.saveImage(url, blob);
    } catch (e) {
        // Ignore errors, we just won't cache it
    }
  }
};
