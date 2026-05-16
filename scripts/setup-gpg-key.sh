#!/usr/bin/env bash
# Generate the StreamAI maintainer GPG key (Ed25519 primary + signing subkey)
# used to sign Linux packages (deb/rpm/pacman/AppImage/tar.xz) and repository
# metadata published on GitHub Pages.
#
# Usage:
#   MAINTAINER_NAME="Mario Rossi" MAINTAINER_EMAIL="mario@example.com" \
#     bash scripts/setup-gpg-key.sh
#
# Or interactive: bash scripts/setup-gpg-key.sh
#
# Outputs (in docs/keys/):
#   streamai-pubkey.asc          armored public key       (committed)
#   streamai-fingerprint.txt     primary key fingerprint  (committed)
#   streamai-revoke.asc          revocation certificate   (GITIGNORED)
#   streamai-master.key.asc.gpg  AES-256 encrypted backup of primary  (GITIGNORED)
#   streamai-signing.key.asc.gpg AES-256 encrypted backup of subkey   (GITIGNORED)
#
# Required env (or interactive prompts):
#   MAINTAINER_NAME       Full name to embed in the UID
#   MAINTAINER_EMAIL      Contact email for the UID
#   GPG_KEY_PASSPHRASE    Passphrase protecting the GPG key (signing)
#   GPG_BACKUP_PASSPHRASE Distinct passphrase used to AES-256 the offline backup
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
KEYS_DIR="$ROOT/docs/keys"
mkdir -p "$KEYS_DIR"

if ! command -v gpg >/dev/null 2>&1; then
  echo "ERROR: gpg is not installed. Install gnupg2 first." >&2
  exit 1
fi

# GPG 2.4+ uses keyboxd (SQLite); stale locks from killed sessions break key
# generation with "SQL library used incorrectly". Force a clean daemon restart
# and remove any leftover lock files in GNUPGHOME before proceeding.
GNUPGHOME="${GNUPGHOME:-$HOME/.gnupg}"
if [[ -d "$GNUPGHOME" ]]; then
  echo "→ Cleaning stale GPG daemons / locks in $GNUPGHOME"
  gpgconf --kill all 2>/dev/null || true
  sleep 1
  find "$GNUPGHOME" -maxdepth 2 -name '*.lock' -o -name 'public-keys.d/*.lock' 2>/dev/null \
    | xargs -r rm -f
fi

prompt_if_empty() {
  local var_name="$1" prompt="$2" secret="${3:-0}"
  local value="${!var_name:-}"
  if [[ -z "$value" ]]; then
    if [[ "$secret" == "1" ]]; then
      read -rsp "$prompt: " value; echo
    else
      read -rp "$prompt: " value
    fi
  fi
  printf -v "$var_name" '%s' "$value"
  export "$var_name"
}

prompt_if_empty MAINTAINER_NAME       "Maintainer full name"
prompt_if_empty MAINTAINER_EMAIL      "Maintainer email"
prompt_if_empty GPG_KEY_PASSPHRASE    "GPG signing passphrase" 1
prompt_if_empty GPG_BACKUP_PASSPHRASE "Offline backup passphrase (different!)" 1

if [[ "$GPG_KEY_PASSPHRASE" == "$GPG_BACKUP_PASSPHRASE" ]]; then
  echo "ERROR: backup passphrase must differ from signing passphrase." >&2
  exit 1
fi

UID_STR="StreamAI Release Signing (${MAINTAINER_NAME}) <${MAINTAINER_EMAIL}>"
echo "→ Generating Ed25519 primary + signing subkey for: $UID_STR"

BATCH=$(mktemp)
trap 'rm -f "$BATCH"' EXIT

cat >"$BATCH" <<EOF
%echo Generating StreamAI Release Signing key
Key-Type: EDDSA
Key-Curve: ed25519
Key-Usage: cert
Subkey-Type: EDDSA
Subkey-Curve: ed25519
Subkey-Usage: sign
Name-Real: ${MAINTAINER_NAME}
Name-Comment: StreamAI Release Signing
Name-Email: ${MAINTAINER_EMAIL}
Expire-Date: 3y
Passphrase: ${GPG_KEY_PASSPHRASE}
%commit
%echo Done
EOF

gpg --batch --pinentry-mode loopback --generate-key "$BATCH"

FPR=$(gpg --list-secret-keys --with-colons "$MAINTAINER_EMAIL" \
  | awk -F: '/^fpr:/ {print $10; exit}')
if [[ -z "$FPR" ]]; then
  echo "ERROR: could not detect generated key fingerprint." >&2
  exit 1
fi
SIGNING_KEYID=$(gpg --list-secret-keys --with-colons "$FPR" \
  | awk -F: '$1=="ssb" && $12 ~ /s/ {print $5; exit}')

echo "✓ Primary fingerprint: $FPR"
echo "✓ Signing subkey id:   $SIGNING_KEYID"

# ---- Public exports (committed) -------------------------------------------
gpg --armor --export "$FPR" > "$KEYS_DIR/streamai-pubkey.asc"
echo "$FPR" > "$KEYS_DIR/streamai-fingerprint.txt"

# ---- Private backups (GITIGNORED) -----------------------------------------
PRIMARY_ARMOR=$(mktemp)
SUBKEY_ARMOR=$(mktemp)
trap 'rm -f "$BATCH" "$PRIMARY_ARMOR" "$SUBKEY_ARMOR"' EXIT

gpg --batch --pinentry-mode loopback --passphrase "$GPG_KEY_PASSPHRASE" \
  --armor --export-secret-keys "$FPR" > "$PRIMARY_ARMOR"
gpg --batch --pinentry-mode loopback --passphrase "$GPG_KEY_PASSPHRASE" \
  --armor --export-secret-subkeys "$FPR" > "$SUBKEY_ARMOR"

gpg --batch --yes --pinentry-mode loopback --passphrase "$GPG_BACKUP_PASSPHRASE" \
  --symmetric --cipher-algo AES256 \
  --output "$KEYS_DIR/streamai-master.key.asc.gpg" "$PRIMARY_ARMOR"
gpg --batch --yes --pinentry-mode loopback --passphrase "$GPG_BACKUP_PASSPHRASE" \
  --symmetric --cipher-algo AES256 \
  --output "$KEYS_DIR/streamai-signing.key.asc.gpg" "$SUBKEY_ARMOR"

# ---- Revocation certificate (GITIGNORED) ----------------------------------
# Since GPG 2.1, `--generate-key` writes a revocation cert automatically to
# $GNUPGHOME/openpgp-revocs.d/<FPR>.rev — we just copy it, since `--gen-revoke`
# cannot run in `--batch` mode on GPG 2.4+ (always requires interactive prompts).
AUTO_REVOKE="${GNUPGHOME}/openpgp-revocs.d/${FPR}.rev"
if [[ -f "$AUTO_REVOKE" ]]; then
  cp "$AUTO_REVOKE" "$KEYS_DIR/streamai-revoke.asc"
else
  echo "⚠ Auto-generated revocation certificate not found at $AUTO_REVOKE" >&2
  echo "  Generate one manually with: gpg --gen-revoke $FPR > $KEYS_DIR/streamai-revoke.asc" >&2
fi

chmod 600 "$KEYS_DIR"/*.gpg "$KEYS_DIR"/streamai-revoke.asc 2>/dev/null || true

cat <<EOM

============================================================================
✓ StreamAI signing key generated.

Public artefacts (commit these):
  - $KEYS_DIR/streamai-pubkey.asc
  - $KEYS_DIR/streamai-fingerprint.txt

Encrypted backups (KEEP OFFLINE, gitignored):
  - $KEYS_DIR/streamai-master.key.asc.gpg
  - $KEYS_DIR/streamai-signing.key.asc.gpg
  - $KEYS_DIR/streamai-revoke.asc

GitHub Secrets to configure on the repository:
  GPG_KEY_ID       = ${SIGNING_KEYID}
  GPG_PASSPHRASE   = (the signing passphrase you just entered)
  GPG_PRIVATE_KEY  = (paste the output of the command below)

    gpg --armor --export-secret-subkeys ${FPR}

After configuring secrets, the workflow .github/workflows/linux-release.yml
will be able to sign Linux packages on every tag push.

Fingerprint to advertise to users:
  ${FPR}
============================================================================
EOM

