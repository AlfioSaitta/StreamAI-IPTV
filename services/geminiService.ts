import { Channel, Recommendation, StreamType, WatchHistoryItem } from "../types.ts";
import { CacheService } from "./cacheService.ts";

// API Key - usa variabile d'ambiente o fallback
const getApiKey = (): string => {
  // Vite env
  if (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GEMINI_API_KEY) {
    return (import.meta as any).env.VITE_GEMINI_API_KEY;
  }
  // Fallback
  return 'AIzaSyAnK6tUgMqre_oZIcQxPog4JPXxxCT65Ho';
};

const apiKey = getApiKey();

// Lazy load del modulo Gemini
let aiInstance: any = null;
const getAI = async () => {
  if (aiInstance) return aiInstance;
  try {
    const { GoogleGenAI } = await import("@google/genai");
    aiInstance = new GoogleGenAI({ 
      apiKey
    });
    return aiInstance;
  } catch (e) {
    console.warn("Impossibile caricare Gemini AI:", e);
    return null;
  }
};

export const getRecommendations = async (
  channels: Channel[], 
  userPreference: string,
  context: StreamType = 'live',
  history: WatchHistoryItem[] = [],
  useCache: boolean = true
): Promise<Recommendation[]> => {
  // 0. Check Cache
  const cacheKey = `ai_recommend_${context}_${userPreference.toLowerCase().trim()}`;
  if (useCache) {
    try {
      const cached = await CacheService.getApiData(cacheKey);
      if (cached && (Date.now() - cached.timestamp < 3600000)) { // 1 hour cache
        console.log("[AI] Returning cached recommendations");
        return cached.results;
      }
    } catch (e) {
      console.warn("Cache error:", e);
    }
  }

  const ai = await getAI();

  if (!ai || !apiKey) {
    return [
      { channelName: "Errore", reason: "Servizio AI non disponibile." }
    ];
  }

  // 1. Analyze intent
  const lowerQuery = userPreference.toLowerCase();
  const isRecencyRequested = /novità|nuov|recent|ultim|quest'anno|questo mese|appena usciti|202[4-9]/i.test(lowerQuery);

  // 2. Pre-processing
  const richItems = channels.filter(c => c.description || c.rating || c.genre || c.year);
  let pool = richItems.length > 20 ? richItems : channels;
  
  if (isRecencyRequested) {
      pool = [...pool].sort((a, b) => {
          const yearA = parseInt(a.year || '0') || 0;
          const yearB = parseInt(b.year || '0') || 0;
          return yearB - yearA;
      });
  } else {
      pool = [...pool].sort(() => 0.5 - Math.random());
  }
  
  // Take top N items
  const selectedItems = pool.slice(0, 50).map(c => ({
    name: c.cleanName || c.name,
    originalName: c.name,
    genre: c.genre || 'N/A',
    year: c.year || 'N/A',
    rating: c.rating || 'N/A',
    plot: c.description ? c.description.substring(0, 100) : ""
  }));

  // Format Metadata for context
  const timeContext = `Orario attuale: ${new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}.`;
  const historyContext = history.length > 0 
    ? `Cronologia recente dell'utente: ${history.slice(0, 5).map(h => h.name).join(", ")}.` 
    : "";

  const userPrompt = `Tipo richiesto: ${context.toUpperCase()}
Richiesta Utente: "${userPreference}"
Contesto: ${timeContext} ${historyContext}

REGOLE:
1. Scegli 3 contenuti dal CATALOGO JSON sotto.
2. Rispondi ESCLUSIVAMENTE con un array JSON: [{"channelName":"...","reason":"..."}].
3. Spiega il motivo in italiano in modo breve e accattivante.

CATALOGO:
${JSON.stringify(selectedItems)}`;

  try {
    const result = await ai.models.generateContent({ 
      model: "gemini-2.0-flash",
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      config: {
        systemInstruction: "Sei un assistente AI esperto di cinema e TV per un'app IPTV chiamata StreamAI. Il tuo compito è fornire raccomandazioni precise basate esclusivamente sul catalogo fornito dall'utente. Rispondi sempre in formato JSON puro, senza blocchi di codice markdown. Non includere spiegazioni fuori dal JSON.",
        temperature: 0.2,
        topP: 0.8,
        topK: 40
      }
    });

    const text = result?.text || "";

    // Estrai JSON dalla risposta
    const jsonMatch = text.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Recommendation[];
      const results = parsed.filter(rec =>
        channels.some(c => c.name === rec.channelName)
      ).slice(0, 3);

      // Save to cache
      if (results.length > 0 && useCache) {
        CacheService.saveApiData(cacheKey, { results, timestamp: Date.now() });
      }
      
      return results;
    }

    return [{ channelName: "Nessun risultato", reason: "Prova con una ricerca diversa." }];
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    const errorMessage = error?.message || "";
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