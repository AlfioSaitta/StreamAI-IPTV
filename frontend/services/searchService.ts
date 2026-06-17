// This service manages the catalog web worker for indexing and searching.
import { Category, Channel } from '../types.ts';
import { IndexedChannel } from './catalogIndex.ts';

let worker: Worker | null = null;
let searchRequestId = 0;
const searchPromises = new Map<number, { resolve: (results: IndexedChannel[]) => void }>();

const getWorker = (): Worker => {
  if (!worker) {
    worker = new Worker(new URL('./catalogWorker.ts', import.meta.url), { type: 'module' });

    worker.onmessage = (e: MessageEvent) => {
      const { action, result, query, id } = e.data;
      if (action === 'search') {
        const promise = searchPromises.get(id);
        if (promise) {
          promise.resolve(result);
          searchPromises.delete(id);
        }
      }
    };
  }
  return worker;
};

export const searchService = {
  index: (
    categories: any[], 
    streams: any[], 
    type: string, 
    baseUrl: string, 
    credentials: any
  ): Promise<Array<Category & { channels: IndexedChannel[] }>> => {
    return new Promise((resolve) => {
      const worker = getWorker();
      
      const onIndexed = (e: MessageEvent) => {
        if (e.data.action === 'index') {
          worker.removeEventListener('message', onIndexed);
          resolve(e.data.result);
        }
      };
      worker.addEventListener('message', onIndexed);

      worker.postMessage({
        action: 'index',
        categories,
        streams,
        type,
        baseUrl,
        credentials,
      });
    });
  },

  search: (query: string, limit = 150): Promise<IndexedChannel[]> => {
    return new Promise((resolve) => {
      const worker = getWorker();
      const id = ++searchRequestId;
      searchPromises.set(id, { resolve });
      worker.postMessage({ action: 'search', query, limit, id });
    });
  },

  terminate: () => {
    if (worker) {
      worker.terminate();
      worker = null;
    }
  }
};