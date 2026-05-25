import platformService from './platformService.ts';

/**
 * User-Agent standard per tutte le richieste verso i provider IPTV.
 * Molti provider bloccano le richieste con User-Agent "vuoto" o "browser standard"
 * se non arrivano da un contesto web autorizzato.
 */
export const IPTV_USER_AGENT = 'StreamAI IPTV';

/**
 * Encoding base64url sicuro per l'uso in URL (equivalente a `base64.RawURLEncoding` in Go).
 */
export const toBase64Url = (str: string): string => {
  const utf8 = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < utf8.length; i++) bin += String.fromCharCode(utf8[i]);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

let proxyInfoLogged = false;

/**
 * Trasforma un URL upstream nell'URL del proxy locale Wails (middleware asset-server).
 * Restituisce l'URL originale se non siamo in ambiente Wails.
 */
export const resolveProxyURL = (url: string): string => {
  if (!platformService.isWails) return url;

  if (!proxyInfoLogged) {
    proxyInfoLogged = true;
    console.info('[ProxyFetch] Routing IPTV requests through Wails asset-server proxy at /iptv-proxy');
  }

  const q = new URLSearchParams();
  q.set('u', toBase64Url(url));
  q.set('ua', IPTV_USER_AGENT);
  return `/iptv-proxy?${q.toString()}`;
};

/**
 * Wrapper attorno a fetch() che instrada la richiesta attraverso il proxy locale
 * se l'ambiente lo richiede (es. Wails su Linux per evitare blocchi CORS/Mixed-Content).
 *
 * @param url URL originale (upstream)
 * @param init Opzioni fetch
 */
export const proxyFetch = async (url: string, init?: RequestInit): Promise<Response> => {
  const target = resolveProxyURL(url);
  const isProxied = target !== url;

  // Clona o crea gli headers
  const headers = new Headers(init?.headers);

  // Se non siamo proxati, impostiamo l'UA best-effort.
  // Se siamo proxati, l'UA viene iniettato lato Go dal middleware del proxy
  // leggendo il parametro `ua=` in query string.
  if (!isProxied && !headers.has('User-Agent')) {
    headers.set('User-Agent', IPTV_USER_AGENT);
  }

  return fetch(target, {
    ...init,
    headers,
  });
};
