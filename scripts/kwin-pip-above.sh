#!/usr/bin/env bash
# kwin-pip-above.sh — tieni la finestra PiP di StreamAI sopra le altre (KDE Plasma).
#
# PERCHÉ SERVE UNO SCRIPT E NON BASTA IL CODICE DELL'APP
#
# Su Wayland nessun protocollo consente a un client di chiedere di restare sopra
# le altre finestre: `gtk_window_set_keep_above` (quello che usa Wails per
# `AlwaysOnTop`) è un no-op lì. L'unico meccanismo che funziona è una **regola
# del compositor**, che vive nella configurazione di KWin e non può essere
# impostata dall'applicazione (l'app dovrebbe riscrivere i file di
# configurazione dell'utente: non è una cosa che un player debba fare).
#
# Questo script crea quella regola con gli strumenti ufficiali di KDE, e la
# rimuove con --remove. È pensato per essere eseguito una volta, a mano.
#
# COME RICONOSCE LA FINESTRA
#
# Solo dal titolo, e il titolo di sistema della finestra PiP è **esattamente**
# `TITLE` qui sotto: la stessa stringa di `osTitle` in
# internal/services/pip/service.go. Se le due divergessero la regola non
# troverebbe più la finestra, quindi un test le tiene agganciate
# (`TestOSTitle_MatchesWindowRuleScript` in internal/services/pip/service_test.go).
#
# Il nome del canale è volutamente **fuori** dal titolo di sistema. `titlematch`
# è un numero in kwinrulesrc, e un confronto "esatto" su un titolo variabile
# ("StreamAI PiP — Rai 1 HD") non troverebbe mai la finestra: la regola
# fallirebbe in silenzio, con l'utente convinto che sia applicata. Con titolo
# della finestra e stringa cercata identici, invece, il confronto riesce con
# qualunque modo — esatto, sottostringa o regex — perché la stringa non contiene
# metacaratteri e contiene sé stessa. La barra HTML della vista PiP continua a
# mostrare il nome del canale.
#
# Deliberatamente NON si usa `wmclass`: su Wayland KWin deriva resourceName e
# resourceClass dall'app-id spezzandolo sul punto, e la corrispondenza con
# `org.wails.streamai` non è garantita (su X11 sarebbe WM_CLASS, che è un'altra
# cosa). Il titolo è il criterio che funziona su entrambi.
#
# Uso:
#   scripts/kwin-pip-above.sh            # crea o aggiorna la regola
#   scripts/kwin-pip-above.sh --status   # mostra la regola attuale
#   scripts/kwin-pip-above.sh --remove   # rimuove la regola

set -euo pipefail

# Percorso assoluto: `--file` con un nome semplice dipende da come KConfig
# risolve il percorso, e questo è il file che l'editor di Impostazioni di sistema
# mostra. Meglio non lasciare dubbi su dove si scrive.
CONFIG="$HOME/.config/kwinrulesrc"
GROUP="General"

# Deve coincidere con osTitle (internal/services/pip/service.go).
TITLE="StreamAI PiP"
DESCRIPTION="StreamAI PiP sopra le altre"

die() { printf '%s\n' "$*" >&2; exit 1; }

command -v kwriteconfig6 >/dev/null || die "kwriteconfig6 non trovato (pacchetto kconfig)"
command -v kreadconfig6 >/dev/null || die "kreadconfig6 non trovato (pacchetto kconfig)"

# Legge la lista delle regole attive (virgole separate).
read_rules() {
  kreadconfig6 --file "$CONFIG" --group "$GROUP" --key rules --default ""
}

# Scrive lista + conteggio: KWin legge entrambi.
write_rules() {
  local list="$1"
  local count
  count=$(printf '%s' "$list" | tr ',' '\n' | grep -c . || true)
  kwriteconfig6 --file "$CONFIG" --group "$GROUP" --key rules "$list"
  kwriteconfig6 --file "$CONFIG" --group "$GROUP" --key count "$count"
}

# reload_kwin fa rileggere la configurazione senza riavviare il compositor.
reload_kwin() {
  if command -v qdbus6 >/dev/null && qdbus6 org.kde.KWin /KWin reconfigure >/dev/null 2>&1; then
    echo "KWin ha ricaricato la configurazione."
  else
    echo "NOTA: KWin non ha confermato il reload; la regola sarà attiva al prossimo accesso." >&2
  fi
}

# find_rule_id cerca la nostra regola per descrizione (la descrizione è ciò che
# l'utente vede in Impostazioni di sistema) e ne stampa l'identificatore.
# Le regole di KWin 6 hanno identificatori UUID, quindi non si può usare una
# costante fissa: la corrispondenza per descrizione rende --status e --remove
# indipendenti da come è nata la regola (script o editor grafico).
find_rule_id() {
  local id desc
  for id in $(printf '%s' "$(read_rules || true)" | tr ',' ' '); do
    desc=$(kreadconfig6 --file "$CONFIG" --group "$id" --key Description --default "")
    if [ "$desc" = "$DESCRIPTION" ]; then
      printf '%s' "$id"
      return 0
    fi
  done
  return 1
}

create_rule() {
  local id
  if id=$(find_rule_id); then
    echo "Regola già presente ($id): aggiorno solo le azioni."
  else
    # UUID generato dal kernel: nessuna dipendenza esterna (uuidgen non è
    # garantito) e stessa forma di quelli scritti dall'editor di KDE.
    id=$(cat /proc/sys/kernel/random/uuid)
  fi

  kwriteconfig6 --file "$CONFIG" --group "$id" --key Description "$DESCRIPTION"
  # 2 = "Forza" (le altre opzioni sono "Non cambiare" e "Applica inizialmente"):
  # senza "Forza" l'azione non vince su una richiesta contraria della finestra.
  kwriteconfig6 --file "$CONFIG" --group "$id" --key above true
  kwriteconfig6 --file "$CONFIG" --group "$id" --key aboverule 2
  kwriteconfig6 --file "$CONFIG" --group "$id" --key title "$TITLE"
  # Vedere l'intestazione: con titolo identico alla stringa cercata, qualunque
  # valore di titlematch funziona. 1 è quello usato dalle regole create
  # dall'editor grafico di questa installazione (es. "Brave PiP").
  kwriteconfig6 --file "$CONFIG" --group "$id" --key titlematch 1

  local rules
  # `|| true`: kreadconfig6 esce non-zero quando il file o la chiave mancano
  # (prima esecuzione), e sotto `set -e` questo farebbe terminare lo script
  # proprio prima di scrivere. Un elenco vuoto è il caso normale qui.
  rules=$(read_rules || true)
  case ",$rules," in
    *",$id,"*) ;;                        # già in lista: aggiornata sopra
    *) rules="${rules:+$rules,}$id" ;;   # aggiunta in coda
  esac
  write_rules "$rules"

  echo "Regola applicata: \"$DESCRIPTION\" → Mantieni sopra le altre = Forza, per la finestra il cui titolo è \"$TITLE\"."
  reload_kwin
  echo "Verifica: apri il PiP con P e controlla che resti davanti a un'altra finestra."
}

remove_rule() {
  local id rules filtered
  if ! id=$(find_rule_id); then
    echo "Nessuna regola \"$DESCRIPTION\" da rimuovere."
    return 0
  fi

  for key in Description above aboverule title titlematch; do
    kwriteconfig6 --file "$CONFIG" --group "$id" --key "$key" --delete 2>/dev/null || true
  done

  rules=$(read_rules || true)
  filtered=$(printf '%s' "$rules" | tr ',' '\n' | grep -v "^${id}$" | paste -sd, - || true)
  write_rules "$filtered"

  echo "Regola rimossa ($id)."
  reload_kwin
}

status_rule() {
  local id
  if ! id=$(find_rule_id); then
    echo "Regola assente: il PiP non resterà sopra le altre finestre finché non la crei."
    echo "Esegui: $0"
    return 0
  fi
  echo "Regola presente ($id):"
  echo "  descrizione = $(kreadconfig6 --file "$CONFIG" --group "$id" --key Description --default '(assente)')"
  echo "  titolo      = $(kreadconfig6 --file "$CONFIG" --group "$id" --key title --default '(non impostato)')"
  echo "  titlematch  = $(kreadconfig6 --file "$CONFIG" --group "$id" --key titlematch --default '(non impostato)') (irrilevante: il titolo coincide con quello della finestra)"
  echo "  above       = $(kreadconfig6 --file "$CONFIG" --group "$id" --key above --default '(non impostato)')"
  echo "  aboverule   = $(kreadconfig6 --file "$CONFIG" --group "$id" --key aboverule --default '(non impostato)') (2 = Forza)"
}

case "${1:-}" in
  --remove) remove_rule ;;
  --status) status_rule ;;
  "")       create_rule ;;
  *)        die "opzione sconosciuta: $1 (usa --status o --remove)" ;;
esac
