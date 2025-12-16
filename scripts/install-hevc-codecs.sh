#!/bin/bash
#
# Script per scaricare e installare libffmpeg con codec proprietari (HEVC/H.265)
# per Electron su Linux
#
# Fonte: https://github.com/BranchBit/electron-chromium-ffmpeg-hevc-prebuilt
#

set -e

ELECTRON_DIR="node_modules/electron/dist"
LIBFFMPEG="$ELECTRON_DIR/libffmpeg.so"

# Versione Electron (legge da package.json)
ELECTRON_VERSION=$(node -p "require('./node_modules/electron/package.json').version" 2>/dev/null || echo "37.2.4")

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "  INSTALLAZIONE CODEC HEVC/H.265 PER ELECTRON"
echo "═══════════════════════════════════════════════════════════════════"
echo ""
echo "Versione Electron: $ELECTRON_VERSION"
echo ""

if [ ! -d "$ELECTRON_DIR" ]; then
    echo "Errore: Electron non trovato. Esegui prima 'npm install'"
    exit 1
fi

# Backup
if [ -f "$LIBFFMPEG" ] && [ ! -f "$LIBFFMPEG.original" ]; then
    echo "Creazione backup di libffmpeg.so originale..."
    cp "$LIBFFMPEG" "$LIBFFMPEG.original"
fi

# URL del repository BranchBit
REPO="BranchBit/electron-chromium-ffmpeg-hevc-prebuilt"
ZIP_NAME="v${ELECTRON_VERSION}-linux-x64-electron-chromium-ffmpeg-hevc-prebuilt.zip"
DOWNLOAD_URL="https://github.com/${REPO}/releases/download/v${ELECTRON_VERSION}/${ZIP_NAME}"

echo "Scaricamento libffmpeg con HEVC..."
echo "URL: $DOWNLOAD_URL"
echo ""

# Directory temporanea
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Download
if curl -L -f -o "$TEMP_DIR/ffmpeg.zip" "$DOWNLOAD_URL" 2>/dev/null; then
    echo "Download completato!"

    # Estrazione
    echo "Estrazione..."
    unzip -q "$TEMP_DIR/ffmpeg.zip" -d "$TEMP_DIR"

    # Trova libffmpeg.so
    FFMPEG_FILE=$(find "$TEMP_DIR" -name "libffmpeg.so" -type f | head -1)

    if [ -n "$FFMPEG_FILE" ]; then
        echo "Installazione libffmpeg.so..."
        cp "$FFMPEG_FILE" "$LIBFFMPEG"
        chmod 755 "$LIBFFMPEG"
        echo ""
        echo "✓ Installazione completata!"
        echo "  Codec HEVC/H.265 abilitati."
        echo ""
    else
        echo "Errore: libffmpeg.so non trovato nell'archivio"
        exit 1
    fi
else
    echo ""
    echo "Download fallito. La versione $ELECTRON_VERSION potrebbe non essere disponibile."
    echo ""
    echo "Versioni disponibili su:"
    echo "  https://github.com/${REPO}/releases"
    echo ""
    echo "Puoi scaricare manualmente e copiare libffmpeg.so in:"
    echo "  $LIBFFMPEG"
    echo ""
    exit 1
fi

