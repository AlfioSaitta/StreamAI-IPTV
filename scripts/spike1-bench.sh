#!/usr/bin/env bash
# SPIKE-1 bench orchestrator — Linux dev host.
# Vedi docs/spike1-methodology.md per la decision matrix.
#
# Usage:
#   scripts/spike1-bench.sh                          # usa SPIKE1_URL=...
#   SPIKE1_URL=https://.../bbb.mkv scripts/spike1-bench.sh
#   SPIKE1_URL=... SPIKE1_DURATION=10m scripts/spike1-bench.sh

set -euo pipefail

URL="${SPIKE1_URL:-}"
DURATION="${SPIKE1_DURATION:-60s}"
OUTDIR="${SPIKE1_OUT:-dist/spike1}"
HARNESS="${SPIKE1_BIN:-build/bin/spike-mpv-render}"

if [[ -z "$URL" ]]; then
  echo "error: set SPIKE1_URL (es. https://.../bbb_4k_hevc.mkv) prima di lanciare lo script" >&2
  exit 2
fi

if [[ ! -x "$HARNESS" ]]; then
  echo "error: harness non trovato in $HARNESS — esegui prima 'task spike:1:build'" >&2
  exit 2
fi

mkdir -p "$OUTDIR"
ts="$(date -u +%Y%m%dT%H%M%SZ)"

declare -a CASES=(
  "1080p|1920|1080"
  "4K|3840|2160"
)

declare -a REPORTS=()
for case_spec in "${CASES[@]}"; do
  IFS='|' read -r label w h <<<"$case_spec"
  report="${OUTDIR}/spike1-${ts}-${label}.json"
  echo "==> SPIKE-1 ${label} (${w}x${h}) — ${DURATION} — ${URL}"
  "$HARNESS" \
    -url "$URL" \
    -duration "$DURATION" \
    -fbo-width "$w" \
    -fbo-height "$h" \
    -output "$report"
  REPORTS+=("$report")
done

echo
echo "==> Reports:"
for r in "${REPORTS[@]}"; do
  result="$(grep -oE '"result"\s*:\s*"(pass|warn|fail)"' "$r" | head -1 | cut -d'"' -f4)"
  printf "    %s  →  %s\n" "$r" "${result:-?}"
done

echo
echo "==> Decision matrix (vedi docs/spike1-methodology.md):"
echo "    Tutti pass     → ✅ procedere con Fase 6.1"
echo "    4K warn/fail   → ⚠️  promuovere SPIKE-5 a mandatory"
echo "    Entrambi fail  → ❌ stop migrazione su questo OS"

