#!/usr/bin/env bash
# 🚀 StreamAI IPTV — Wails v3 Linux Packaging Pipeline (Fase 8)
# Produce .deb, .rpm e .pkg.tar.zst usando wails3 + nfpm.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

# 1. Caricamento versione
VERSION=$(cat .version | tr -d '[:space:]')
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
RELEASE="1"

echo "▶ Building StreamAI IPTV v$VERSION ($COMMIT)..."

# 2. Build Wails (Vite + Go)
# Nota: wails:build esegue 'bash scripts/build-wails.sh'
npm run wails:build

# Verfica binario
if [ ! -f "build/bin/streamai" ]; then
    echo "❌ Errore: binario build/bin/streamai non trovato!"
    exit 1
fi

# 3. Preparazione cartella output
mkdir -p dist/packages

# 4. Packaging con nfpm
export VERSION
export RELEASE

PACKAGERS=("deb" "rpm" "archlinux")

for pkg in "${PACKAGERS[@]}"; do
    echo "📦 Packaging for $pkg..."
    
    # Estensione file
    EXT=$pkg
    [[ "$pkg" == "archlinux" ]] && EXT="pkg.tar.zst"
    
    # Nome file output
    OUT="dist/packages/streamai-iptv_${VERSION}_${COMMIT}_amd64.${EXT}"
    
    # Esecuzione nfpm
    nfpm pkg --packager "$pkg" --target "$OUT"
    
    echo "✅ Generated: $OUT"
done

# 5. Firma (opzionale, se GPG_KEY_ID è settato)
if [ -n "${GPG_KEY_ID:-}" ]; then
    echo "🔏 Signing packages with GPG key $GPG_KEY_ID..."
    for f in dist/packages/*; do
        if [[ "$f" == *.sig || "$f" == *.asc ]]; then continue; fi
        gpg --detach-sign --armor --local-user "$GPG_KEY_ID" "$f"
    done
    # Generazione SHA256SUMS
    (cd dist/packages && sha256sum * > SHA256SUMS)
    gpg --detach-sign --armor --local-user "$GPG_KEY_ID" dist/packages/SHA256SUMS
fi

echo "✨ Linux packaging complete!"
