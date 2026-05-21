#!/usr/bin/env bash
# Build dello Wails v3 backend (Go) di StreamAI-IPTV.
#
# Replica della task `build` del Taskfile.yml ma senza richiedere il
# binario `task`. Compila l'eseguibile Go corretto:
#
#   build/bin/streamai        # release (-s -w, trimpath)
#   build/bin/streamai-debug  # debug (-N -l)
#
# Vincoli:
#   - Esegue prima `vite build` (output in frontend/dist/) così
#     `assets.go` con `//go:embed all:frontend/dist` ha contenuti reali.
#   - Build-tag `gtk3` di default su Linux (webkit2gtk-4.1). Override:
#     `TAGS="" bash scripts/build-wails.sh` su distro con webkitgtk-6.0.
#   - Versione propagata da `.version` (single source of truth) via
#     ldflags `-X main.version=...`, commit SHA breve via `-X main.commitSHA=...`.
#
# Vedi: docs/plan-go-wails-migration.md §2.2, Taskfile.yml `build`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

DEBUG=0
SKIP_FRONTEND=0
for arg in "$@"; do
  case "$arg" in
    --debug)         DEBUG=1 ;;
    --skip-frontend) SKIP_FRONTEND=1 ;;
    -h|--help)
      sed -n '1,25p' "$0"
      exit 0 ;;
    *) echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done

TAGS="${TAGS:-gtk3}"
BIN_NAME="${BIN_NAME:-streamai}"
BIN_DIR="${BIN_DIR:-build/bin}"

if [[ -r "$ROOT/.version" ]]; then
  VERSION="$(tr -d '[:space:]' < "$ROOT/.version")"
else
  VERSION="dev"
fi

COMMIT_SHA="${COMMIT_SHA:-${GITHUB_SHA:-}}"
if [[ -z "$COMMIT_SHA" ]] && command -v git >/dev/null 2>&1; then
  COMMIT_SHA="$(git -C "$ROOT" rev-parse --short=7 HEAD 2>/dev/null || true)"
fi
COMMIT_SHA="${COMMIT_SHA:0:7}"

if [[ "$SKIP_FRONTEND" != "1" ]]; then
  echo "▶ Vite build → frontend/dist/ (consumato da //go:embed in assets.go)"
  if [[ ! -x "$ROOT/node_modules/.bin/vite" ]]; then
    echo "✗ node_modules/.bin/vite non trovato. Esegui prima 'npm install'." >&2
    exit 3
  fi
  "$ROOT/node_modules/.bin/vite" build
fi

if [[ ! -f "$ROOT/frontend/dist/index.html" ]]; then
  echo "✗ frontend/dist/index.html mancante: assets.go non avrebbe contenuti da embeddare." >&2
  exit 4
fi

mkdir -p "$BIN_DIR"

LDFLAGS="-s -w -X main.version=${VERSION} -X main.commitSHA=${COMMIT_SHA}"
OUT="$BIN_DIR/$BIN_NAME"
BUILD_ARGS=(go build -tags "$TAGS" -trimpath -ldflags "$LDFLAGS" -o "$OUT" ./cmd/streamai)

if [[ "$DEBUG" == "1" ]]; then
  OUT="$BIN_DIR/${BIN_NAME}-debug"
  BUILD_ARGS=(go build -tags "$TAGS" -gcflags "all=-N -l" -o "$OUT" ./cmd/streamai)
  echo "▶ Build Go (debug) → $OUT"
else
  echo "▶ Build Go (release) → $OUT"
fi
echo "  TAGS=$TAGS VERSION=$VERSION COMMIT=$COMMIT_SHA"

"${BUILD_ARGS[@]}"

ls -lh "$OUT"
if command -v file >/dev/null 2>&1; then
  file "$OUT"
fi

echo "✓ Built $OUT (v${VERSION}${COMMIT_SHA:+_${COMMIT_SHA}})"

