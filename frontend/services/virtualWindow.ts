/**
 * Finestra di elementi da renderizzare in una riga virtualizzata.
 *
 * PERCHÉ È UNA FUNZIONE A SÉ. Due motivi:
 *
 *  - è la parte che *deve* essere giusta: indici sbagliati significano elementi
 *    mancanti (buchi nella riga) o spazio vuoto in fondo;
 *  - è l'unica parte verificabile senza un browser vero, perché jsdom non
 *    calcola il layout e quindi non si può "guardare" il risultato.
 *
 * L'`overscan` è quanto si renderizza oltre i bordi: serve a coprire lo
 * scorrimento fra un fotogramma e l'altro, così l'utente non vede mai un buco
 * mentre trascina.
 */
/**
 * True se una larghezza misurata è utilizzabile per calcolare la finestra.
 *
 * Serve perché la misura può arrivare **zero** e non per un errore: le righe
 * fuori schermo sono saltate dal rendering (`content-visibility: auto`), e una
 * lettura di layout dentro un sottoalbero saltato può tornare 0 prima che il
 * browser lo ri-renderizzi. Con 0 la finestra diventerebbe `[scrollLeft/176-8,
 * start+8]` — cioè una decina di elementi invece di quelli che stanno nella
 * riga — e la riga lampeggerebbe smontando e rimontando le card.
 *
 * Meglio tenere l'ultimo valore buono: la riga fuori schermo non ha nulla da
 * mostrare comunque, e quando rientra la misura torna quella vera.
 */
export const isUsableViewportWidth = (width: number): boolean =>
  Number.isFinite(width) && width > 0;

export const virtualWindow = (
  scrollLeft: number,
  viewportWidth: number,
  itemExtent: number,
  total: number,
  overscan: number,
  virtualize: boolean,
): { start: number; end: number } => {
  // Con pochi elementi la virtualizzazione costa più di quanto renda: si
  // renderizza tutto (è anche ciò che rende la riga completa al primo paint).
  if (!virtualize) return { start: 0, end: total };

  const start = Math.max(0, Math.floor(scrollLeft / itemExtent) - overscan);
  const end = Math.min(total, Math.ceil((scrollLeft + viewportWidth) / itemExtent) + overscan);
  return { start, end };
};
