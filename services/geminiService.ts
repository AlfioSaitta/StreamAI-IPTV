import { GoogleGenAI, Type } from "@google/genai";
import { Channel, Recommendation, StreamType, WatchHistoryItem } from "../types.ts";

const apiKey = process.env.API_KEY || 'AIzaSyDqvYuOecmgDNi2sVm3jvgM9bl-oKdUPck'; 
const ai = new GoogleGenAI({ apiKey });

export const getRecommendations = async (
  channels: Channel[], 
  userPreference: string,
  context: StreamType = 'live',
  history: WatchHistoryItem[] = []
): Promise<Recommendation[]> => {
  if (!apiKey) {
    return [
      { channelName: "Error", reason: "API Key mancante. Verifica la configurazione." }
    ];
  }

  // 1. Analyze intent
  const lowerQuery = userPreference.toLowerCase();
  const isRecencyRequested = /novità|nuov|recent|ultim|quest'anno|questo mese|appena usciti|202[4-9]/i.test(lowerQuery);

  // 2. Pre-processing
  const richItems = channels.filter(c => c.description || c.rating || c.genre || c.year);
  let pool = richItems.length > 20 ? richItems : channels;
  
  if (isRecencyRequested) {
      pool = pool.sort((a, b) => {
          const yearA = parseInt(a.year || '0') || 0;
          const yearB = parseInt(b.year || '0') || 0;
          return yearB - yearA;
      });
  } else {
      pool = pool.sort(() => 0.5 - Math.random());
  }
  
  // Take top N items
  const selectedItems = pool.slice(0, 60).map(c => ({
    name: c.cleanName || c.name, 
    originalName: c.name,
    info: `[${c.genre || 'Genere N/A'}] [${c.year || 'Anno N/A'}] [Rating: ${c.rating || 'N/A'}]`,
    plot: c.description ? c.description.substring(0, 150) + "..." : "No description"
  }));

  // Format History for Prompt
  const recentHistory = history.slice(0, 10).map(h => h.name).join(", ");
  const historyContext = recentHistory 
    ? `L'utente ha recentemente guardato: ${recentHistory}. Usa questa informazione per capire i gusti dell'utente (es. se guarda molti film d'azione, privilegia quel genere se la richiesta è vaga).`
    : "L'utente non ha una cronologia recente.";

  const todayStr = new Date().toLocaleDateString('it-IT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const systemInstruction = `Sei un esperto curatore di media per una piattaforma IPTV. 
  
  DATA CORRENTE: ${todayStr}.
  
  CRONOLOGIA UTENTE:
  ${historyContext}
  
  Contesto attuale: ${context.toUpperCase()}.
  
  Richiesta Utente: "${userPreference}".
  
  Analizza la lista fornita. Scegli 3 contenuti.
  
  Regole:
  1. Se l'utente chiede qualcosa "in base ai miei gusti", basati pesantemente sulla cronologia.
  2. Se la richiesta è specifica (es. "film horror"), ignora la cronologia se non pertinente.
  3. Il campo 'channelName' DEVE corrispondere esattamente a 'originalName' del JSON input.
  4. 'reason' deve essere in Italiano, accattivante e, se rilevante, citare perché piace in base alla cronologia (es. "Visto che ti è piaciuto X...").`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: JSON.stringify(selectedItems),
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              channelName: { type: Type.STRING },
              reason: { type: Type.STRING }
            }
          }
        }
      }
    });

    if (response.text) {
        return JSON.parse(response.text) as Recommendation[];
    }
    return [];
  } catch (error) {
    console.error("Gemini API Error:", error);
    return [
        { channelName: "Errore AI", reason: "Non sono riuscito a elaborare la richiesta al momento." }
    ];
  }
};