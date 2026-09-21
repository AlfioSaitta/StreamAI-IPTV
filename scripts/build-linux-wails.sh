#!/usr/bin/env bash
# Shim di compatibilità.
#
# Questa pipeline è stata sostituita da `scripts/build-linux.sh`, che aggiunge
# il packaging per-distro (i nomi di dipendenza di openSUSE non sono quelli di
# Fedora), l'archivio portatile, il preflight e la verifica.
#
# Il file resta perché il vecchio nome è citato nella documentazione e in
# `docs/INSTALL.md`: inoltra gli argomenti al nuovo script invece di duplicare
# la logica. Usa direttamente `scripts/build-linux.sh` (o `npm run dist:linux`).
set -euo pipefail
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/build-linux.sh" "$@"
