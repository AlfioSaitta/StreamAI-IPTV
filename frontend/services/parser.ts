import { Channel, Category } from '../types.ts';

/**
 * Hash deterministico FNV-1a a 32 bit. Serve a derivare id di canale
 * **stabili** invece che casuali (vedi `buildStableChannelId`).
 */
const stableHash = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
};

export const parseM3U = (content: string): Category[] => {
  const lines = content.split('\n');
  const channels: Channel[] = [];
  let currentChannel: Partial<Channel> = {};
  // Conta le occorrenze della stessa chiave: playlist reali contengono voci
  // duplicate identiche, e senza questo contatore colliderebbero sullo stesso
  // id (key React duplicate + lookup ambiguo).
  const idOccurrences = new Map<string, number>();

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      // Extract metadata
      // Example: #EXTINF:-1 tvg-logo="http://..." group-title="News",BBC News
      const info = line.substring(8);
      const nameParts = info.split(',');
      const displayName = nameParts[nameParts.length - 1].trim();
      
      const logoMatch = info.match(/tvg-logo="([^"]*)"/);
      const groupMatch = info.match(/group-title="([^"]*)"/);
      const tvgIdMatch = info.match(/tvg-id="([^"]*)"/);

      currentChannel = {
        name: displayName,
        logo: logoMatch ? logoMatch[1] : undefined,
        group: groupMatch ? groupMatch[1] : 'Uncategorized',
        tvgId: tvgIdMatch && tvgIdMatch[1] ? tvgIdMatch[1] : undefined,
      };
    } else if (!line.startsWith('#')) {
      // This is the URL line
      if (currentChannel.name) {
        // L'id viene derivato qui (non in `#EXTINF`) perché serve anche l'URL.
        // Deve essere STABILE tra un parse e l'altro: con un UUID casuale ogni
        // reload/refresh della playlist cambiava tutti gli id, e preferiti,
        // "continua a guardare" e reminder EPG (che referenziano i canali per
        // id) restavano orfani — le sezioni si svuotavano senza alcun errore.
        const baseKey = `${currentChannel.tvgId ?? ''}|${line}|${currentChannel.name}`;
        const occurrence = idOccurrences.get(baseKey) ?? 0;
        idOccurrences.set(baseKey, occurrence + 1);
        const hash = stableHash(baseKey);

        channels.push({
          ...currentChannel,
          id: occurrence === 0 ? `m3u-${hash}` : `m3u-${hash}-${occurrence}`,
          url: line,
        } as Channel);
        currentChannel = {};
      }
    }
  }

  // Group by category
  const groups: Record<string, Channel[]> = {};
  channels.forEach(ch => {
    const groupName = ch.group || 'Uncategorized';
    if (!groups[groupName]) {
      groups[groupName] = [];
    }
    groups[groupName].push(ch);
  });

  return Object.keys(groups).sort().map(groupName => ({
    name: groupName,
    channels: groups[groupName]
  }));
};

export const getDemoPlaylist = (): string => {
  return `#EXTM3U
#EXTINF:-1 group-title="News" tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/6/62/BBC_News_2019.svg/1200px-BBC_News_2019.svg.png",BBC News
http://content.uplynk.com/channel/3324f2467c414329b3b0cc5cd987b6be.m3u8
#EXTINF:-1 group-title="Music" tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Vevo_logo.svg/2560px-Vevo_logo.svg.png",Vevo Pop
http://v7.f2.phx.hls.vevo.com/channels/49494/index.m3u8
#EXTINF:-1 group-title="Tech" tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/NASA_logo.svg/2449px-NASA_logo.svg.png",NASA Public
https://ntv1.akamaized.net/hls/live/2013530/NASA-NTV1-HLS/master.m3u8
#EXTINF:-1 group-title="Movies" tvg-logo="https://picsum.photos/200",Classic Cinema
http://amssamples.streaming.mediaservices.windows.net/91492735-c523-432b-ba01-faba6c2206a2/AzureMediaServicesPromo.ism/manifest(format=m3u8-aapl)
`;
};