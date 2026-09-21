#!/usr/bin/env bash
# Firma gli artefatti Linux prodotti da `scripts/build-linux.sh`.
#
# La firma è PER FORMATO, perché ogni gestore la vuole diversa:
#   *.deb            debsigs (o dpkg-sig) — firma embedded nel pacchetto
#   *.rpm            rpmsign/rpm --addsign — firma embedded nell'header
#   *.pkg.tar.zst    gpg --detach-sign → .sig BINARIO (pacman non legge armor)
#   *.tar.gz         gpg --detach-sign --armor → .asc
# Poi SHA256SUMS e SHA256SUMS.asc.
#
# Una firma unica `.asc` per tutti i formati (come faceva la pipeline
# precedente) è peggio di nessuna firma: i pacchetti sembrano firmati e non
# sono verificabili da `rpm --checksig` né da `pacman -U`.
#
# Env:
#   GPG_KEY_ID       key id o fingerprint della chiave di firma (obbligatorio)
#   GPG_PASSPHRASE   passphrase; se assente si usa gpg-agent
#
# Usage: sign-linux-packages.sh [--strict]
#   --strict  un tool di firma mancante è un errore (exit 6) invece di un avviso
#
# Exit: 2 uso errato · 6 tool mancante in --strict · 7 nessun pacchetto trovato
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# `dist/packages` è dove scrive build-linux.sh. Il vecchio valore (`dist/`)
# faceva trovare zero file, quindi lo script usciva con un errore che parlava
# ancora di electron-builder: era rotto e nessuno se ne accorgeva perché non
# era invocato da nessuno.
DIST="${DIST_DIR:-$ROOT/dist/packages}"

STRICT=0
for arg in "$@"; do
  case "$arg" in
    --strict) STRICT=1 ;;
    *) echo "opzione sconosciuta: '$arg' (vedi commento in testa)" >&2; exit 2 ;;
  esac
done

: "${GPG_KEY_ID:?GPG_KEY_ID deve essere impostato}"

cd "$DIST"
shopt -s nullglob

FAILED=0
# Deve ritornare SEMPRE 0: è usata come `cmd || manca "..."`, e in quella forma
# un ritorno non-zero è "il comando che segue l'ultimo ||" — quindi non esente
# da `set -e`, che interromperebbe lo script al primo tool mancante invece di
# proseguire con gli altri formati.
manca() { # $1=messaggio
  printf '  ⚠️  %s\n' "$1" >&2
  FAILED=1
  if ((STRICT)); then
    printf '  ❌ --strict: firma incompleta\n' >&2
    exit 6
  fi
  return 0
}

# ─── gpg: la passphrase NON passa da argv ───────────────────────────────────
# `--passphrase "$GPG_PASSPHRASE"` la renderebbe visibile a `ps` per chiunque
# sulla macchina. Con `--passphrase-fd 0` arriva da stdin e non lascia traccia
# nella lista dei processi.
gpg_sign() { # $1=output  $2=input  [altri flag gpg]
  local out="$1" in="$2"; shift 2
  if [[ -n "${GPG_PASSPHRASE:-}" ]]; then
    printf '%s' "$GPG_PASSPHRASE" | gpg --batch --yes --pinentry-mode loopback \
      --passphrase-fd 0 -u "$GPG_KEY_ID" --output "$out" "$@" "$in"
  else
    gpg --batch --yes --pinentry-mode loopback -u "$GPG_KEY_ID" --output "$out" "$@" "$in"
  fi
}

# ─── sanity: non firmare un elenco vuoto ────────────────────────────────────
# Senza questo controllo `sha256sum` con un glob che non matcha nulla legge da
# stdin e produce un manifest con una sola riga `-`, che poi *passa* la
# verifica pur non corrispondendo ad alcun pacchetto.
PKGS=()
for g in *.deb *.rpm *.pkg.tar.zst *.tar.gz; do
  for f in $g; do [[ -e "$f" ]] && PKGS+=("$f"); done
done
if ((${#PKGS[@]} == 0)); then
  echo "  ❌ nessun pacchetto in $DIST — niente da firmare" >&2
  echo "     (producili con: npm run dist:linux)" >&2
  exit 7
fi
echo "▶ ${#PKGS[@]} pacchetti da firmare in $DIST"

# ─── .deb ───────────────────────────────────────────────────────────────────
for f in *.deb; do
  if command -v debsigs >/dev/null 2>&1; then
    debsigs --sign=origin -k "$GPG_KEY_ID" "$f" || manca "debsigs ha fallito su $f"
  elif command -v dpkg-sig >/dev/null 2>&1; then
    dpkg-sig -k "$GPG_KEY_ID" --sign builder "$f" || manca "dpkg-sig ha fallito su $f"
  else
    # Atteso su openSUSE/Fedora/Arch: debsigs e dpkg-sig sono pacchetti
    # Debian-family. La firma dei .deb si fa in CI, su un runner Ubuntu.
    manca "$f: né debsigs né dpkg-sig installati (normale fuori da Debian/Ubuntu; la CI li ha)"
  fi
done

# ─── .rpm ───────────────────────────────────────────────────────────────────
# Si preferisce `rpmsign` (binario autonomo) a `rpm --addsign`, che richiede il
# plugin rpm-sign. La passphrase NON viene passata: si affida a gpg-agent, così
# non finisce in argv attraverso %__gpg_sign_cmd.
if compgen -G '*.rpm' >/dev/null; then
  RPM_MACROS="$HOME/.rpmmacros"
  if ! grep -qs '^%_gpg_name' "$RPM_MACROS"; then
    printf '%%_signature gpg\n%%_gpg_name %s\n' "$GPG_KEY_ID" >> "$RPM_MACROS"
    echo "  ℹ creato $RPM_MACROS con %_gpg_name = $GPG_KEY_ID"
  fi
  RPM_SIGN_CMD=()
  if command -v rpmsign >/dev/null 2>&1; then
    RPM_SIGN_CMD=(rpmsign --addsign)
  elif rpm --addsign --help >/dev/null 2>&1; then
    RPM_SIGN_CMD=(rpm --addsign)
  fi
  for f in *.rpm; do
    if ((${#RPM_SIGN_CMD[@]})); then
      "${RPM_SIGN_CMD[@]}" "$f" || manca "$f: firma rpm fallita (gpg-agent ha la passphrase in cache?)"
    else
      manca "$f: né rpmsign né il plugin rpm-sign disponibili (su openSUSE: zypper in rpm-sign)"
    fi
  done
fi

# ─── .pkg.tar.zst: .sig BINARIO ─────────────────────────────────────────────
for f in *.pkg.tar.zst; do
  gpg_sign "${f}.sig" "$f" --detach-sign || manca "firma di $f fallita"
done

# ─── portatile: .asc ────────────────────────────────────────────────────────
for f in *.tar.gz; do
  gpg_sign "${f}.asc" "$f" --armor --detach-sign || manca "firma di $f fallita"
done

# ─── checksum ───────────────────────────────────────────────────────────────
# Elenco esplicito: con un glob vuoto `sha256sum` leggerebbe da stdin.
if ((${#PKGS[@]})); then
  sha256sum "${PKGS[@]}" | sort > SHA256SUMS
  if gpg_sign SHA256SUMS.asc SHA256SUMS --armor --detach-sign; then
    echo "  ✅ SHA256SUMS + SHA256SUMS.asc"
  else
    # Non si annuncia un successo che non c'è: SHA256SUMS esiste, la firma no.
    manca "SHA256SUMS generato ma NON firmato"
  fi
fi

# ─── verifica di ciò che è verificabile ─────────────────────────────────────
# Una firma non verificata è un'ipotesi. Qui si controlla almeno che il file di
# firma corrisponda davvero all'artefatto.
for f in *.pkg.tar.zst *.tar.gz; do
  sig="$f.sig"; [[ -e "$sig" ]] || sig="$f.asc"
  if [[ -e "$sig" ]]; then
    gpg --verify "$sig" "$f" >/dev/null 2>&1 \
      && echo "  ✅ firma valida: $sig" \
      || manca "firma NON valida: $sig"
  fi
done

if ((FAILED)); then
  echo "⚠️  firma completata con avvisi (vedi sopra)" >&2
else
  echo "✓ firma completata"
fi
