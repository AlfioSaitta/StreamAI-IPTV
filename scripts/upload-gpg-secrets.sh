#!/usr/bin/env bash
# Upload StreamAI signing material to the GitHub repository as encrypted
# Actions secrets via the gh CLI.
#
# This is the recommended way to provision GPG_PRIVATE_KEY / GPG_PASSPHRASE /
# GPG_KEY_ID for the Linux release workflow without ever pasting the private
# key into the GitHub web UI or any file tracked by git.
#
# The secrets are stored encrypted by GitHub (libsodium-sealed boxes) and only
# decrypted in-memory at workflow runtime. They are NEVER printed in CI logs
# (GitHub redacts them automatically).
#
# Usage:
#   GPG_BACKUP_PASSPHRASE="..." \
#   GPG_PASSPHRASE="..." \
#     bash scripts/upload-gpg-secrets.sh
#
# Or fully interactive:
#   bash scripts/upload-gpg-secrets.sh
#
# Requirements:
#   - gh CLI authenticated (`gh auth login`)
#   - docs/keys/streamai-signing.key.asc.gpg (created by scripts/setup-gpg-key.sh)
#   - docs/keys/streamai-fingerprint.txt
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
KEYS="$ROOT/docs/keys"

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: gh CLI is not installed. https://cli.github.com/" >&2
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "ERROR: gh CLI not authenticated. Run: gh auth login" >&2
  exit 1
fi

SIGNING_BLOB="$KEYS/streamai-signing.key.asc.gpg"
FPR_FILE="$KEYS/streamai-fingerprint.txt"

if [[ ! -f "$SIGNING_BLOB" || ! -f "$FPR_FILE" ]]; then
  cat >&2 <<EOF
ERROR: signing key backup not found.

Expected:
  $SIGNING_BLOB
  $FPR_FILE

Run \`npm run gpg:setup\` first to generate the maintainer key.
EOF
  exit 2
fi

prompt_secret() {
  local var="$1" label="$2"
  local value="${!var:-}"
  if [[ -z "$value" ]]; then
    read -rsp "$label: " value; echo
  fi
  printf -v "$var" '%s' "$value"
  export "$var"
}

prompt_secret GPG_BACKUP_PASSPHRASE "Backup passphrase (decrypts streamai-signing.key.asc.gpg)"
prompt_secret GPG_PASSPHRASE        "Signing passphrase (will be stored as GitHub secret)"

FPR="$(cat "$FPR_FILE")"

echo "→ Decrypting subkey backup…"
PRIVATE_KEY_ARMOR=$(gpg --batch --pinentry-mode loopback --passphrase "$GPG_BACKUP_PASSPHRASE" \
  --decrypt "$SIGNING_BLOB" 2>/dev/null)

if [[ -z "$PRIVATE_KEY_ARMOR" ]] || ! grep -q "BEGIN PGP PRIVATE KEY BLOCK" <<<"$PRIVATE_KEY_ARMOR"; then
  echo "ERROR: decryption failed (wrong backup passphrase?)." >&2
  exit 3
fi

REPO_FLAG=()
if [[ -n "${REPO:-}" ]]; then REPO_FLAG=(--repo "$REPO"); fi

echo "→ Uploading GitHub Actions secrets to $(gh repo view "${REPO_FLAG[@]}" --json nameWithOwner -q .nameWithOwner)"

gh secret set GPG_PRIVATE_KEY "${REPO_FLAG[@]}" --body "$PRIVATE_KEY_ARMOR"
gh secret set GPG_PASSPHRASE  "${REPO_FLAG[@]}" --body "$GPG_PASSPHRASE"
gh secret set GPG_KEY_ID      "${REPO_FLAG[@]}" --body "$FPR"

echo
echo "✓ Secrets uploaded (encrypted server-side, never echoed to logs):"
gh secret list "${REPO_FLAG[@]}" | grep -E '^GPG_(PRIVATE_KEY|PASSPHRASE|KEY_ID)' || true

cat <<EOM

Next steps:
  - Push a tag (e.g. v1.0.1) or trigger the workflow manually:
      gh workflow run linux-release.yml
  - Verify on the Actions tab that the 'Import GPG signing key' step
    succeeds and downstream signing/verification jobs are green.
EOM

