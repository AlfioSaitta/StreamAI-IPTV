import { Channel, Recommendation, StreamType, WatchHistoryItem } from "../types.ts";
import { CacheService } from "./cacheService.ts";

const AI_RECOMMENDATION_TTL_MS = 60 * 60 * 1000;
const AI_ENRICHMENT_TTL_MS = 24 * 60 * 60 * 1000;
const AI_CACHE_MAX_ENTRIES = 120;

interface RecommendationOptions {
  language?: string;
  profileId?: string;
  preferredGenres?: string[];
}

// API Key - usa solo variabile d'ambiente Vite. Non inserire chiavi nel codice sorgente.
const getApiKey = (customApiKey?: string): string => {
  if (customApiKey?.trim()) {
    return customApiKey.trim();
  }
  if (import.meta.env?.VITE_GEMINI_API_KEY) {
    return import.meta.env.VITE_GEMINI_API_KEY;
  }
  return '';
};

const apiKey = getApiKey();

// Lazy load del modulo Gemini
let aiInstance: any = null;
let currentKey: string | null = null;

// Circuit Breaker State
const SUSPENSION_KEY = 'ai_service_suspended_until';
const SUSPENSION_DURATION = 30 * 60 * 1000; // 30 minutes

const isSuspended = (): boolean => {
  const suspendedUntil = localStorage.getItem(SUSPENSION_KEY);
  if (!suspendedUntil) return false;
  
  const now = Date.now();
  if (now < parseInt(suspendedUntil)) {
    return true;
  } else {
    localStorage.removeItem(SUSPENSION_KEY);
    return false;
  }
};

const suspendService = () => {
  const until = Date.now() + SUSPENSION_DURATION;
  localStorage.setItem(SUSPENSION_KEY, until.toString());
  console.warn(`[AI Service] Suspended for 30 minutes due to critical error.`);
};

const stableHash = (input: string): string => {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
};

const getLanguageName = (language = 'it'): string => {
  const names: Record<string, string> = {
    it: 'italiano',
    en: 'inglese',
    es: 'spagnolo',
    fr: 'francese',
    de: 'tedesco',
    pt: 'portoghese',
    ru: 'russo',
    ja: 'giapponese',
    ko: 'coreano',
    zh: 'cinese',
    ar: 'arabo'
  };
  return names[language.split('-')[0]] || language;
};

const getPromptProfile = (context: StreamType): string => {
  if (context === 'movie') {
    return 'Sei un curatore cinematografico per VOD: privilegia genere, anno, cast, trama, tono e contenuti non già visti.';
  }
  if (context === 'series') {
    return 'Sei un curatore di serie TV: privilegia generi seriali, durata ideale, continuità narrativa, stagioni disponibili e gusti recenti.';
  }
  return 'Sei un assistente TV live: privilegia orario attuale, notizie, sport, intrattenimento, canali tematici e zapping rapido.';
};

const derivePreferredGenres = (channels: Channel[], history: WatchHistoryItem[], explicitGenres: string[] = []): string[] => {
  const score = new Map<string, number>();
  explicitGenres.forEach(genre => score.set(genre, (score.get(genre) || 0) + 5));

  history.slice(0, 30).forEach((item, index) => {
    const channel = channels.find(c => c.id === item.channelId || c.name === item.name || c.cleanName === item.name);
    const genres = [channel?.genre, channel?.group].filter(Boolean).flatMap(value => String(value).split(/[,/|]/));
    genres.forEach(rawGenre => {
      const genre = rawGenre.trim();
      if (genre.length >= 3) score.set(genre, (score.get(genre) || 0) + Math.max(1, 6 - Math.floor(index / 5)));
    });
  });

  return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([genre]) => genre);
};

const scoreChannelForAI = (
  channel: Channel,
  query: string,
  context: StreamType,
  recentIds: Set<string>,
  preferredGenres: string[]
): number => {
  if (recentIds.has(channel.id)) return -1000;
  let score = 0;
  const lowerQuery = query.toLowerCase();
  const text = [channel.cleanName, channel.name, channel.genre, channel.group, channel.description, channel.year]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  lowerQuery.split(/\s+/).filter(token => token.length > 2).forEach(token => {
    if (text.includes(token)) score += 8;
  });

  preferredGenres.forEach(genre => {
    if (text.includes(genre.toLowerCase())) score += 6;
  });

  if (channel.description) score += 3;
  if (channel.rating) score += Math.min(5, Number(channel.rating) || 0);
  if (context !== 'live' && channel.year) score += Math.min(4, Math.max(0, Number(channel.year) - 1990) / 10);
  if (channel.type === context) score += 4;

  return score;
};

export const hasAiApiKey = (customApiKey?: string): boolean => {
  return !!getApiKey(customApiKey);
};

export const isAiTemporarilySuspended = (): boolean => isSuspended();

export const isAiAvailable = (customApiKey?: string): boolean => {
  return !isSuspended() && hasAiApiKey(customApiKey);
};

const getAI = async (customApiKey?: string) => {
  if (isSuspended()) {
    console.log("[AI Service] Service is currently suspended.");
    return null;
  }

  const activeKey = getApiKey(customApiKey) || apiKey;

  // Se la chiave è cambiata, ricrea l'istanza
  if (aiInstance && currentKey === activeKey) return aiInstance;
  
  try {
    const { GoogleGenAI } = await import("@google/genai");
    aiInstance = new GoogleGenAI({ 
      apiKey: activeKey
    });
    currentKey = activeKey;
    return aiInstance;
  } catch (e) {
    console.warn("Impossibile caricare Gemini AI:", e);
    return null;
  }
};

export interface MovieEnrichment {
  cast: string[];
  similarMovies: string[];
  funFact?: string;
}

export const getMovieEnrichment = async (
  movieTitle: string,
  useCache: boolean = true,
  customApiKey?: string
): Promise<MovieEnrichment | null> => {
  if (isSuspended() || !hasAiApiKey(customApiKey)) return null;

  const cacheKey = `ai_enrich_${movieTitle.toLowerCase().trim().replace(/[^a-z0-9]/g, '')}`;
  
  if (useCache) {
    try {
      const cached = await CacheService.getApiData(cacheKey, { maxAgeMs: AI_ENRICHMENT_TTL_MS });
      if (cached) return cached;
    } catch (e) {
      console.warn("Cache error:", e);
    }
  }

  const ai = await getAI(customApiKey);
  if (!ai) return null;

  const prompt = `Analizza il film "${movieTitle}".
Restituisci un JSON con questi campi:
- "cast": array di stringhe con i 5 attori principali.
- "similarMovies": array di stringhe con 5 titoli di film simili per genere o atmosfera.
- "funFact": una curiosità breve e interessante sul film (in italiano).

Rispondi SOLO con il JSON.`;

  try {
    const result = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { temperature: 0.1 }
    });

    const text = result?.text || "";
    const jsonMatch = text.match(/\{[\s\S]*?}/);

    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]) as MovieEnrichment;
      if (useCache) {
        CacheService.saveApiData(cacheKey, data);
        CacheService.pruneApiCache('ai_', AI_CACHE_MAX_ENTRIES).catch(() => undefined);
      }
      return data;
    }
  } catch (e: any) {
    console.error("AI Enrichment error:", e);
    // Se è un errore server (5xx) o di quota (429), sospendi il servizio
    if (e.message?.includes('500') || e.message?.includes('503') || e.message?.includes('429')) {
      suspendService();
    }
  }
  return null;
};

export const getRecommendations = async (
  channels: Channel[], 
  userPreference: string,
  context: StreamType = 'live',
  history: WatchHistoryItem[] = [],
  useCache: boolean = true,
  customApiKey?: string,
  options: RecommendationOptions = {}
): Promise<Recommendation[]> => {
  if (isSuspended()) {
    return [{ channelName: "AI non disponibile", reason: "Servizio temporaneamente sospeso." }];
  }

  if (!hasAiApiKey(customApiKey)) {
    return [{ channelName: "AI non configurata", reason: "Aggiungi una chiave Gemini nelle impostazioni profilo per abilitare i consigli." }];
  }

  const language = options.language || 'it';
  const preferredGenres = derivePreferredGenres(channels, history, options.preferredGenres);
  const recentHistory = history
    .filter(item => item.type === context || context === 'home')
    .slice(0, 20);
  const recentIds = new Set(recentHistory.map(item => item.channelId));
  const catalogFingerprint = stableHash(`${channels.length}:${channels[0]?.id || ''}:${channels[channels.length - 1]?.id || ''}`);
  const cacheKey = `ai_recommend_${options.profileId || 'default'}_${language}_${context}_${catalogFingerprint}_${stableHash(userPreference.toLowerCase().trim())}`;
  if (useCache) {
    try {
      const cached = await CacheService.getApiData(cacheKey, { maxAgeMs: AI_RECOMMENDATION_TTL_MS });
      if (cached?.results) {
        console.log("[AI] Returning cached recommendations");
        return cached.results;
      }
    } catch (e) {
      console.warn("Cache error:", e);
    }
  }

  const ai = await getAI(customApiKey);

  if (!ai || (!apiKey && !customApiKey)) {
    return [
      { channelName: "Errore", reason: "Servizio AI non disponibile o API Key mancante." }
    ];
  }

  // 1. Analyze intent
  const lowerQuery = userPreference.toLowerCase();
  const isRecencyRequested = /novità|nuov|recent|ultim|quest'anno|questo mese|appena usciti|202[4-9]/i.test(lowerQuery);

  // 2. Pre-processing
  const eligibleChannels = channels.filter(channel => !recentIds.has(channel.id));
  const richItems = eligibleChannels.filter(c => c.description || c.rating || c.genre || c.year);
  let pool = richItems.length > 20 ? richItems : eligibleChannels;

  if (isRecencyRequested) {
      pool = [...pool].sort((a, b) => {
          const yearA = parseInt(a.year || '0') || 0;
          const yearB = parseInt(b.year || '0') || 0;
          return yearB - yearA;
      });
  } else {
      pool = [...pool].sort((a, b) =>
        scoreChannelForAI(b, userPreference, context, recentIds, preferredGenres) -
        scoreChannelForAI(a, userPreference, context, recentIds, preferredGenres)
      );
  }
  
  // Take top N items
  const selectedItems = pool.slice(0, 40).map(c => ({
    id: c.id,
    name: c.cleanName || c.name,
    originalName: c.name,
    genre: c.genre || 'N/A',
    year: c.year || 'N/A',
    rating: c.rating || 'N/A',
    plot: c.description ? c.description.substring(0, 100) : ""
  }));

  // Format Metadata for context
  const timeContext = `Orario attuale: ${new Date().toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })}.`;
  const historyContext = history.length > 0
    ? `Cronologia recente dell'utente da evitare se possibile: ${recentHistory.slice(0, 8).map(h => h.name).join(", ")}.`
    : "";
  const genreContext = preferredGenres.length > 0 ? `Generi preferiti stimati: ${preferredGenres.join(', ')}.` : '';

  const userPrompt = `Tipo richiesto: ${context.toUpperCase()}
Richiesta Utente: "${userPreference}"
Lingua risposta: ${getLanguageName(language)} (${language}).
Contesto: ${timeContext} ${historyContext} ${genreContext}

REGOLE:
1. Scegli 3 contenuti dal CATALOGO JSON sotto.
2. Rispondi ESCLUSIVAMENTE con un array JSON: [{"channelName":"...","reason":"..."}].
3. Spiega il motivo nella lingua richiesta in modo breve e accattivante.
4. Non suggerire contenuti presenti nella cronologia recente se esistono alternative valide.

CATALOGO:
${JSON.stringify(selectedItems)}`;

  try {
    const result = await ai.models.generateContent({ 
      model: "gemini-2.0-flash",
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      config: {
        systemInstruction: `${getPromptProfile(context)} Il tuo compito è fornire raccomandazioni precise basate esclusivamente sul catalogo fornito dall'utente. Rispondi sempre in formato JSON puro, senza blocchi di codice markdown. Non includere spiegazioni fuori dal JSON.`,
        temperature: 0.2,
        topP: 0.8,
        topK: 40
      }
    });

    const text = result?.text || "";

    // Estrai JSON dalla risposta
    const jsonMatch = text.match(/\[[\s\S]*?]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Recommendation[];
      const results = parsed.filter(rec =>
        channels.some(c => c.name === rec.channelName)
      ).slice(0, 3);

      // Save to cache
      if (results.length > 0 && useCache) {
        CacheService.saveApiData(cacheKey, { results, timestamp: Date.now() });
        CacheService.pruneApiCache('ai_', AI_CACHE_MAX_ENTRIES).catch(() => undefined);
      }
      
      return results;
    }

    return [{ channelName: "Nessun risultato", reason: "Prova con una ricerca diversa." }];
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    const errorMessage = error?.message || "";
    
    // Circuit Breaker Trigger
    if (errorMessage.includes("500") || errorMessage.includes("503") || errorMessage.includes("429") || errorMessage.includes("fetch failed")) {
      suspendService();
      return [{ channelName: "Servizio Sospeso", reason: "L'AI è temporaneamente non disponibile. Riprova più tardi." }];
    }

    if (errorMessage.includes("404") || errorMessage.includes("not found")) {
      return [
        { channelName: "Errore Configurazione", reason: "Il modello AI non è stato trovato. Verifica la versione API." }
      ];
    }
    return [
      { channelName: "Errore AI", reason: "Richiesta fallita. Riprova tra poco." }
    ];
  }
};