import { Channel, Recommendation, StreamType, WatchHistoryItem } from "../types.ts";

// API Key - usa variabile d'ambiente o fallback
const getApiKey = (): string => {
  // Vite env
  if (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GEMINI_API_KEY) {
    return (import.meta as any).env.VITE_GEMINI_API_KEY;
  }
  // Fallback
  return 'AIzaSyDqvYuOecmgDNi2sVm3jvgM9bl-oKdUPck';
};

const apiKey = getApiKey();

// Lazy load del modulo Gemini
let aiInstance: any = null;
const getAI = async () => {
  if (aiInstance) return aiInstance;
  try {
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    aiInstance = new GoogleGenerativeAI(apiKey);
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
  history: WatchHistoryItem[] = []
): Promise<Recommendation[]> => {
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

  // Format History for Prompt
  const recentHistory = history.slice(0, 5).map(h => h.name).join(", ");
  const historyContext = recentHistory
    ? `Cronologia utente: ${recentHistory}.`
    : "";

  const prompt = `Sei un assistente per IPTV. Trova 3 contenuti dal catalogo.

Tipo: ${context.toUpperCase()}
Richiesta: "${userPreference}"
${historyContext}

CATALOGO:
${JSON.stringify(selectedItems)}

Rispondi SOLO con JSON array:
[{"channelName":"nome_esatto_da_originalName","reason":"motivo breve in italiano"}]`;

  try {
    const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    // Estrai JSON dalla risposta
    const jsonMatch = text.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Recommendation[];
      // Verifica che i canali esistano nel catalogo
      return parsed.filter(rec =>
        channels.some(c => c.name === rec.channelName)
      ).slice(0, 3);
    }

    return [{ channelName: "Nessun risultato", reason: "Prova con una ricerca diversa." }];
  } catch (error) {
    console.error("Gemini API Error:", error);
    return [
      { channelName: "Errore AI", reason: "Richiesta fallita. Riprova tra poco." }
    ];
  }
};