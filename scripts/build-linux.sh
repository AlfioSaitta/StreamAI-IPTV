#!/usr/bin/env bash
# 🚀 StreamAI IPTV — pipeline di packaging Linux per-distro.
#
# Produce, per ogni distro della tabella `build/depends/distros.json`:
#   .deb  (Debian, Ubuntu) · .rpm (openSUSE, Fedora, RHEL) · .pkg.tar.zst (Arch)
#   + un archivio portatile .tar.gz per le glibc non coperte.
#
# PERCHÉ NON BASTAVA `nfpm.yaml` DA SOLO. nfpm supporta `overrides` solo per
# packager, mai per distro: openSUSE e Fedora sono entrambe rpm ma con nomi di
# pacchetto diversi, e con i nomi Fedora l'RPM non si installa su openSUSE (che è
# la distro host di questo progetto). Qui le dipendenze si leggono dalla tabella
# per-distro e la config nfpm viene generata al volo da
# `scripts/make-nfpm-config.mjs`.
#
# Il binario è lo STESSO per tutte le distro (stessi soname, stessa glibc): si
# compila una volta e si impacchetta N volte. `--skip-build` salta la
# compilazione ma mai il preflight, così non si etichetta un binario vecchio con
# una versione nuova.
#
# Usage:
#   scripts/build-linux.sh [--distro NOME]... [--host] [--all]
#                          [--skip-build] [--skip-frontend] [--skip-icons]
#                          [--sign|--no-sign] [--verify] [-h]
#
# Default senza flag: tutte le distro (--all).
# Exit: 2 uso errato · 3 .version non valido · 4 binario mancante
#       5 nfpm mancante · 6 icone mancanti · 7 verifica fallita

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

readonly TABLE="$ROOT/build/depends/distros.json"
readonly OUT_DIR="dist/packages"
readonly NFPM_DIR="dist/nfpm"
readonly BIN="build/bin/streamai"
readonly ICON_SIZES=(16 32 48 64 128 256 512)

readonly E_USAGE=2 E_VERSION=3 E_BIN=4 E_NFPM=5 E_ICONS=6 E_VERIFY=7

# ─── output ─────────────────────────────────────────────────────────────────
bold() { printf '\033[1m%s\033[0m\n' "$*"; }
step() { printf '\n▶ %s\n' "$*"; }
ok()   { printf '  ✅ %s\n' "$*"; }
warn() { printf '  ⚠️  %s\n' "$*" >&2; }
die()  { printf '  ❌ %s\n' "$1" >&2; exit "${2:-1}"; }

usage() {
  cat <<'USAGE'
Uso: scripts/build-linux.sh [opzioni]

  --distro NOME     Impacchetta solo questa distro (ripetibile). Nomi validi:
                    opensuse, fedora, rhel, debian, ubuntu, arch, portable
  --host            Solo la distro rilevata da /etc/os-release
  --all             Tutte le distro (default)
  --skip-build      Non ricompilare: riusa build/bin/streamai
  --skip-frontend   Salta solo la build Vite (passa --skip-frontend a build-wails.sh)
  --skip-icons      Non generare le icone mancanti (fallisce invece di generarle)
  --sign            Firma i pacchetti con GPG (default: solo se GPG_KEY_ID è impostato)
  --no-sign         Non firmare, anche se GPG_KEY_ID è impostato
  --verify          Ispeziona i pacchetti prodotti e confronta i binari
  -h, --help        Questo messaggio
USAGE
}

# ─── argomenti ──────────────────────────────────────────────────────────────
DISTROS=()
MODE="all"
SKIP_BUILD=0 SKIP_FRONTEND=0 SKIP_ICONS=0 VERIFY=0
# auto: firma solo se GPG_KEY_ID è nell'ambiente (comportamento storico).
SIGN=auto

while (($#)); do
  case "$1" in
    --distro)     [[ $# -ge 2 ]] || die "--distro richiede un nome" "$E_USAGE"; DISTROS+=("$2"); shift 2 ;;
    --distro=*)   DISTROS+=("${1#*=}"); shift ;;
    --host)       MODE="host"; shift ;;
    --all)        MODE="all"; shift ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --skip-frontend) SKIP_FRONTEND=1; shift ;;
    --skip-icons) SKIP_ICONS=1; shift ;;
    --sign)       SIGN=1; shift ;;
    --no-sign)    SIGN=0; shift ;;
    --verify)     VERIFY=1; shift ;;
    -h|--help)    usage; exit 0 ;;
    *)            die "opzione sconosciuta: '$1' (usa -h)" "$E_USAGE" ;;
  esac
done

# ─── lettura tabella distro ─────────────────────────────────────────────────
all_distros() {
  node -e 'process.stdout.write(Object.keys(require(process.argv[1]).distros).join(" "))' "$TABLE"
}

# Stampa "packager<TAB>ext<TAB>label" per una distro, o esce 2 se sconosciuta.
# Il newline finale è obbligatorio: senza, `read` in un process substitution
# riceve EOF senza delimitatore, ritorna non-zero, e con `set -e` interrompe
# lo script a metà preflight.
distro_meta() {
  node -e '
    const t = require(process.argv[1]).distros;
    const d = t[process.argv[2]];
    if (!d) { console.error("distro sconosciuta: " + process.argv[2]); process.exit(2); }
    process.stdout.write([d.packager, d.ext, d.label || d.packager].join("\t") + "\n");
  ' "$TABLE" "$1"
}

# Riconosce la distro host da /etc/os-release: prima ID, poi ID_LIKE.
resolve_host() {
  node -e '
    const fs = require("fs");
    const table = require(process.argv[1]).distros;
    let id = "", like = [];
    try {
      for (const line of fs.readFileSync("/etc/os-release", "utf8").split("\n")) {
        const m = line.match(/^([A-Z_]+)=(.*)$/);
        if (!m) continue;
        const v = m[2].replace(/^"|"$/g, "");
        if (m[1] === "ID") id = v;
        else if (m[1] === "ID_LIKE") like = v.split(/\s+/).filter(Boolean);
      }
    } catch { /* os-release assente: si prosegue senza match */ }
    const entries = Object.entries(table);
    const byId = entries.find(([, d]) => (d.ids || []).includes(id));
    if (byId) process.stdout.write(byId[0] + "\n");
    else {
      const byLike = entries.find(([, d]) => (d.ids || []).some((x) => like.includes(x)));
      if (byLike) process.stdout.write(byLike[0] + "\n");
      else process.exit(1);
    }
  ' "$TABLE"
}

# ─── preflight ──────────────────────────────────────────────────────────────
step "Preflight"

# La versione la valida sync-version.mjs (unica fonte di verità): esce 3 se
# `.version` non è un x.y.z stretto. Il commit deve essere a 7 caratteri come
# negli ldflags di build-wails.sh, altrimenti il nome file diverge dallo SHA
# che l'app riporta in Diagnostica.
VERSION="$(node scripts/sync-version.mjs --print)" || die ".version non valido" "$E_VERSION"
COMMIT="$(node scripts/sync-version.mjs --print-commit)"
readonly VERSION COMMIT
ok "versione $VERSION${COMMIT:+ (commit $COMMIT)}"

# Distro richieste
if ((${#DISTROS[@]})); then
  MODE="explicit"
elif [[ "$MODE" == "host" ]]; then
  HOST_DISTRO="$(resolve_host)" || die "distro host non riconosciuta: aggiungila a build/depends/distros.json" "$E_USAGE"
  DISTROS=("$HOST_DISTRO")
  ok "distro host riconosciuta: $HOST_DISTRO"
else
  # shellcheck disable=SC2207  # nomi senza spazi, dalla tabella
  DISTROS=($(all_distros))
fi

# Valida i nomi PRIMA di costruire: un refuso non deve costare una build.
for d in "${DISTROS[@]}"; do
  distro_meta "$d" >/dev/null 2>&1 || die "distro sconosciuta: '$d' (vedi -h)" "$E_USAGE"
done

# nfpm serve solo se c'è almeno una distro non-portatile.
NEEDS_NFPM=0
for d in "${DISTROS[@]}"; do
  IFS=$'\t' read -r _pkg _ext _lbl < <(distro_meta "$d")
  [[ "$_pkg" == "tar" ]] || NEEDS_NFPM=1
done
if ((NEEDS_NFPM)); then
  command -v nfpm >/dev/null 2>&1 || die "nfpm non trovato nel PATH (serve per deb/rpm/archlinux)" "$E_NFPM"
  # `nfpm --version` stampa un banner multiriga senza newline finali: si estrae
  # solo il numero, altrimenti l'output del preflight diventa illeggibile.
  ok "nfpm $(nfpm --version 2>&1 | grep -oE 'GitVersion:[[:space:]]*[0-9][0-9.]*' | grep -oE '[0-9][0-9.]*' | head -1 || echo presente)"
fi

# Icone: `build/icons/` è gitignorata, quindi su un clone pulito nfpm fallisce
# per src mancanti. Si generano e POI si riverificano tutte e sette: il fallback
# di generate-icons.mjs senza `sharp` produce solo 512x512.
icons_ok() { local s; for s in "${ICON_SIZES[@]}"; do [[ -f "build/icons/${s}x${s}.png" ]] || return 1; done; }
if ! icons_ok; then
  if ((SKIP_ICONS)); then
    die "icone mancanti in build/icons/ e --skip-icons è attivo" "$E_ICONS"
  fi
  warn "icone mancanti: le genero (npm run icons:generate)"
  node scripts/generate-icons.mjs
  icons_ok || die "generazione icone incompleta: mancano taglie in build/icons/ (serve 'sharp': npm install)" "$E_ICONS"
fi
ok "icone presenti (${#ICON_SIZES[@]} taglie)"

# ─── build ──────────────────────────────────────────────────────────────────
if ((SKIP_BUILD)); then
  step "Build saltata (--skip-build)"
  [[ -x "$BIN" ]] || die "binario $BIN assente o non eseguibile: togli --skip-build" "$E_BIN"
  ok "riuso $BIN"
else
  step "Build (Vite + Go, tag 'gtk3 mpv')"
  BUILD_ARGS=()
  ((SKIP_FRONTEND)) && BUILD_ARGS+=(--skip-frontend)
  bash scripts/build-wails.sh "${BUILD_ARGS[@]}"
  [[ -x "$BIN" ]] || die "build completata ma $BIN non è eseguibile" "$E_BIN"
fi

mkdir -p "$OUT_DIR" "$NFPM_DIR"
export VERSION RELEASE=1

# ─── packaging ──────────────────────────────────────────────────────────────
# Nome artefatto: streamai-iptv_<version>[_<commit>]_<distro>_amd64.<ext>
# Il segmento <distro> non è decorativo: i glob di scripts/publish-repo.sh
# (`*_<distro>_*.deb`) lo cercano per popolare i canali apt/rpm/arch.
artifact_name() { # $1=distro $2=ext
  local n="streamai-iptv_${VERSION}"
  [[ -n "$COMMIT" ]] && n+="_${COMMIT}"
  printf '%s_%s_amd64.%s' "$n" "$1" "$2"
}

# Archivio portatile: nfpm non ha un packager tar, quindi si prepara uno staging
# con il layout di un prefisso (/bin, /share) e si archivia quello.
build_portable() { # $1=output
  local stage="dist/portable" name="streamai-iptv-${VERSION}" s
  rm -rf "$stage"
  mkdir -p "$stage/$name/bin" "$stage/$name/share/applications"
  install -m755 "$BIN" "$stage/$name/bin/streamai"
  install -m644 build/streamai.desktop "$stage/$name/share/applications/streamai.desktop"
  for s in "${ICON_SIZES[@]}"; do
    install -Dm644 "build/icons/${s}x${s}.png" \
      "$stage/$name/share/icons/hicolor/${s}x${s}/apps/streamai.png"
  done

  cat > "$stage/$name/install.sh" <<'INSTALL_EOF'
#!/usr/bin/env bash
# Installa StreamAI IPTV in ~/.local (default) o in /usr/local (--system).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
prefix="$HOME/.local"
if [[ "${1:-}" == "--system" ]]; then prefix="/usr/local"; fi

install -Dm755 "$here/bin/streamai" "$prefix/bin/streamai"
install -Dm644 "$here/share/applications/streamai.desktop" \
  "$prefix/share/applications/streamai.desktop"
for size in 16 32 48 64 128 256 512; do
  install -Dm644 "$here/share/icons/hicolor/${size}x${size}/apps/streamai.png" \
    "$prefix/share/icons/hicolor/${size}x${size}/apps/streamai.png"
done

# Cache desktop/icone: solo se gli strumenti esistono, senza far fallire nulla.
command -v update-desktop-database >/dev/null && \
  update-desktop-database "$prefix/share/applications" 2>/dev/null || true
command -v gtk-update-icon-cache >/dev/null && \
  gtk-update-icon-cache -q -t -f "$prefix/share/icons/hicolor" 2>/dev/null || true

echo "StreamAI IPTV installato in $prefix"
echo "Avvialo con: streamai"
INSTALL_EOF
  chmod 755 "$stage/$name/install.sh"

  tar -czf "$1" -C "$stage" "$name"
  rm -rf "$stage"
}

ARTIFACTS=()
for d in "${DISTROS[@]}"; do
  IFS=$'\t' read -r pkg ext label < <(distro_meta "$d")
  out="$OUT_DIR/$(artifact_name "$d" "$ext")"
  step "Pacchetto per $label ($d → $pkg)"

  if [[ "$pkg" == "tar" ]]; then
    build_portable "$out"
  else
    # Config generata per-distro: è l'unico punto in cui openSUSE e Fedora
    # divergono, dato che condividono il packager rpm.
    node scripts/make-nfpm-config.mjs "$d" --out "$NFPM_DIR/$d.yaml"
    nfpm pkg --config "$NFPM_DIR/$d.yaml" --packager "$pkg" --target "$out"
  fi

  [[ -s "$out" ]] || die "artefatto non prodotto: $out"
  ARTIFACTS+=("$out")
  ok "$out ($(du -h "$out" | cut -f1))"
done

# ─── firma ──────────────────────────────────────────────────────────────────
if [[ "$SIGN" == "auto" ]]; then
  [[ -n "${GPG_KEY_ID:-}" ]] && SIGN=1 || SIGN=0
fi
if ((SIGN)); then
  step "Firma GPG"
  if [[ -x scripts/sign-linux-packages.sh ]]; then
    bash scripts/sign-linux-packages.sh
  else
    warn "scripts/sign-linux-packages.sh non eseguibile: firma saltata"
  fi
else
  step "Firma saltata (nessun --sign e GPG_KEY_ID non impostato)"
fi

# ─── verifica ───────────────────────────────────────────────────────────────
if ((VERIFY)); then
  step "Verifica dei pacchetti"
  fails=0
  first_hash=""
  declare -A HASHES=()

  # NOTA su `pipefail` (vale per tutte le estrazioni qui sotto): una pipeline in
  # cui uno stadio legittimamente non trova nulla — `rpm -qp --recommends` che
  # stampa `(none)`, un `grep` senza match, `bsdtar` su un membro assente — fa
  # fallire l'INTERA sostituzione, e `set -e` interrompe lo script. Il `|| true`
  # in coda serve a lasciar gestire il caso vuoto al chiamante invece di morire:
  # senza, il ramo "impossibile estrarre il binario" sarebbe irraggiungibile.

  # sha256 di /usr/bin/streamai contenuto nel pacchetto (stringa vuota se assente).
  bin_hash() {
    case "$1" in
      *.rpm)         rpm2cpio "$1" | bsdtar -xOf - ./usr/bin/streamai 2>/dev/null | sha256sum | cut -d' ' -f1 || true ;;
      *.deb)         ar p "$1" "$(ar t "$1" | grep '^data\.tar' || true)" | bsdtar -xOf - ./usr/bin/streamai 2>/dev/null | sha256sum | cut -d' ' -f1 || true ;;
      *.pkg.tar.zst) bsdtar -xOf "$1" ./usr/bin/streamai 2>/dev/null | sha256sum | cut -d' ' -f1 || true ;;
      *.tar.gz)      tar -xzOf "$1" "streamai-iptv-${VERSION}/bin/streamai" 2>/dev/null | sha256sum | cut -d' ' -f1 || true ;;
      *)             true ;;
    esac
  }

  # Lista di valori separata da ", " (vedi il commento su paste più sotto).
  join_commas() { paste -sd, - | sed 's/,/, /g' || true; }

  # Il controllo che conta davvero: lo STESSO binario dentro ogni pacchetto.
  # Se un pacchetto contenesse un binario diverso (build stantia, path sbagliato
  # nella config generata) gli hash divergerebbero.
  for f in "${ARTIFACTS[@]}"; do
    base="$(basename "$f")"
    h="$(bin_hash "$f")"
    if [[ -z "$h" ]]; then
      warn "$base: impossibile estrarre il binario"; fails=1
    else
      HASHES["$base"]="$h"
      [[ -n "$first_hash" ]] || first_hash="$h"
    fi
  done

  if ((${#HASHES[@]})); then
    uniq_hashes="$(printf '%s\n' "${HASHES[@]}" | sort -u | wc -l)"
    if [[ "$uniq_hashes" == "1" ]]; then
      ok "stesso binario in tutti i ${#HASHES[@]} gli artefatti (sha256 ${first_hash:0:12}…)"
    else
      warn "binari DIVERSI fra i pacchetti:"; printf '     %s\n' "${!HASHES[@]}"; fails=1
    fi
  fi

  # Dipendenze dichiarate, per formato. `paste -sd', '` NON è un separatore
  # ", ": paste consuma la lista in modo ciclico (',', poi ' ', poi ',', …) e
  # produce "a,b c". Si usa una virgola singola e si aggiunge lo spazio dopo.
  for f in "${ARTIFACTS[@]}"; do
    base="$(basename "$f")"
    case "$f" in
      *.rpm)
        req="$(rpm -qp --requires "$f" 2>/dev/null | grep -vE '^rpmlib|^/bin/sh' | join_commas || true)"
        rec="$(rpm -qp --recommends "$f" 2>/dev/null | grep -v '^(none)$' | join_commas || true)"
        printf '  %s\n     Requires: %s\n' "$base" "${req:-<nessuna>}"
        [[ -n "$rec" ]] && printf '     Recommends: %s\n' "$rec"
        ;;
      *.deb)
        member="$(ar t "$f" | grep '^control\.tar' || true)"
        ctl="$(ar p "$f" "$member" | bsdtar -xOf - ./control 2>/dev/null | grep -E '^(Depends|Recommends):' || true)"
        printf '  %s\n' "$base"
        printf '     %s\n' "${ctl:-<nessuna dipendenza>}"
        ;;
      *.pkg.tar.zst)
        dep="$(bsdtar -xOf "$f" .PKGINFO 2>/dev/null | grep '^depend' | cut -d'=' -f2 | tr -d ' ' | join_commas || true)"
        printf '  %s\n     depend: %s\n' "$base" "${dep:-<nessuna>}"
        ;;
      *.tar.gz)
        printf '  %s\n     contenuto: %s file attesi (binario, .desktop, 7 icone)\n' "$base" \
          "$(tar -tzf "$f" | grep -cE 'bin/streamai$|\.desktop$|\.png$' || true)"
        ;;
    esac
  done

  ((fails)) && die "verifica fallita" "$E_VERIFY"
  ok "verifica superata"
fi

bold ""
bold "✨ Packaging completato — ${#ARTIFACTS[@]} artefatti in $OUT_DIR/"
printf '   %s\n' "${ARTIFACTS[@]}"
