#!/usr/bin/env bash
# Sign every Linux artefact in dist/ with the StreamAI maintainer GPG key.
#
# Required env:
#   GPG_KEY_ID       Long key id (or fingerprint) of the signing subkey.
#   GPG_PASSPHRASE   Passphrase unlocking the signing subkey (optional when
#                    gpg-agent already cached it).
#
# Signs:
#   *.deb               via dpkg-sig (preferred) or debsigs fallback
#   *.rpm               via rpm --addsign + ~/.rpmmacros
#   *.pkg.tar.zst       via gpg --detach-sign (.sig)         — pacman convention
#   *.AppImage *.tar.xz via gpg --detach-sign --armor (.asc) — portable convention
#
# Generates dist/SHA256SUMS and dist/SHA256SUMS.asc.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST="$ROOT/dist"

: "${GPG_KEY_ID:?GPG_KEY_ID must be set}"

GPG_ARGS=(--batch --yes --pinentry-mode loopback -u "$GPG_KEY_ID")
if [[ -n "${GPG_PASSPHRASE:-}" ]]; then
  GPG_ARGS+=(--passphrase "$GPG_PASSPHRASE")
fi

cd "$DIST"

shopt -s nullglob

# ---- Sanity check: refuse to sign an empty dist/ -------------------------
# Without this, `sha256sum` with nullglob expansion to zero args silently
# reads from stdin and produces a manifest with a single `-` entry,
# which then passes signature/checksum verification while no actual
# package was built. That hides upstream build failures (e.g. an
# electron-builder `directories.output` override pointing elsewhere)
# until the cross-check loop at the end of the workflow.
mapfile -t _pkgs < <(printf '%s\n' *.deb *.rpm *.pkg.tar.zst *.AppImage *.tar.xz *.tar.gz)
if (( ${#_pkgs[@]} == 0 )); then
  echo "::error::No packages found in $DIST — nothing to sign." >&2
  echo "::error::Check that electron-builder wrote its output to dist/" >&2
  echo "::error::(no 'directories.output' override in package.json.build)." >&2
  exit 7
fi
echo "▶ Found ${#_pkgs[@]} package(s) to sign: ${_pkgs[*]}"

# ---- .deb ------------------------------------------------------------------
for f in *.deb; do
  echo "▶ Signing $f (deb)"
  if command -v dpkg-sig >/dev/null 2>&1; then
    if [[ -n "${GPG_PASSPHRASE:-}" ]]; then
      dpkg-sig -k "$GPG_KEY_ID" --gpg-options "--batch --pinentry-mode loopback --passphrase $GPG_PASSPHRASE" --sign builder "$f"
    else
      dpkg-sig -k "$GPG_KEY_ID" --sign builder "$f"
    fi
  elif command -v debsigs >/dev/null 2>&1; then
    debsigs --sign=origin -k "$GPG_KEY_ID" "$f"
  else
    echo "✗ Neither dpkg-sig nor debsigs is installed — cannot sign $f." >&2
    echo "  Install one of them (apt-get install dpkg-sig debsigs) and retry." >&2
    exit 6
  fi
done

# ---- .rpm ------------------------------------------------------------------
if compgen -G '*.rpm' >/dev/null; then
  echo "▶ Signing RPMs"
  RPM_MACROS="$HOME/.rpmmacros"
  if [[ ! -f "$RPM_MACROS" ]] || ! grep -q "^%_gpg_name" "$RPM_MACROS"; then
    {
      echo "%_signature gpg"
      echo "%_gpg_name $GPG_KEY_ID"
      echo "%__gpg_sign_cmd %{__gpg} gpg --batch --no-armor --pinentry-mode loopback --passphrase \"%{_gpg_passphrase}\" --no-secmem-warning -u \"%{_gpg_name}\" -sbo %{__signature_filename} --digest-algo sha256 %{__plaintext_filename}"
    } >> "$RPM_MACROS"
  fi
  for f in *.rpm; do
    echo "▶ Signing $f (rpm)"
    if [[ -n "${GPG_PASSPHRASE:-}" ]]; then
      rpm --define "_gpg_passphrase $GPG_PASSPHRASE" --addsign "$f"
    else
      rpm --addsign "$f"
    fi
  done
fi

# ---- .pkg.tar.zst (Arch) ---------------------------------------------------
for f in *.pkg.tar.zst; do
  echo "▶ Signing $f (pacman .sig)"
  gpg "${GPG_ARGS[@]}" --output "${f}.sig" --detach-sign "$f"
done

# ---- .AppImage / .tar.xz / .tar.gz -----------------------------------------
for f in *.AppImage *.tar.xz *.tar.gz; do
  [[ -e "$f" ]] || continue
  echo "▶ Signing $f (.asc)"
  gpg "${GPG_ARGS[@]}" --armor --output "${f}.asc" --detach-sign "$f"
done

# ---- Checksums -------------------------------------------------------------
echo "▶ Generating SHA256SUMS"
( cd "$DIST" && sha256sum *.deb *.rpm *.pkg.tar.zst *.AppImage *.tar.xz *.tar.gz 2>/dev/null \
  | sort > SHA256SUMS ) || true
if [[ -s SHA256SUMS ]]; then
  gpg "${GPG_ARGS[@]}" --armor --output SHA256SUMS.asc --detach-sign SHA256SUMS
  echo "✓ SHA256SUMS + SHA256SUMS.asc"
fi

echo "✓ Signing complete."

