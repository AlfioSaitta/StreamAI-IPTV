#!/usr/bin/env bash
# Import the maintainer signing key into the runner's GPG keyring.
#
# Manual replacement for crazy-max/ghaction-import-gpg, which fails when the
# secret was exported via `gpg --export-secret-subkeys` (creates a primary-key
# stub with no secret material): the action tries to preset the passphrase for
# the stub's keygrip and gpg-agent answers
#   ERR 67108891 Not found <GPG Agent>
#
# This script:
#   - sets up loopback pinentry so signing works without TTY
#   - imports the armored private key from $GPG_PRIVATE_KEY
#   - verifies the requested $GPG_KEY_ID is now present
#
# Required env: GPG_PRIVATE_KEY, GPG_KEY_ID
set -euo pipefail

: "${GPG_PRIVATE_KEY:?GPG_PRIVATE_KEY must be set}"
: "${GPG_KEY_ID:?GPG_KEY_ID must be set}"

GNUPGHOME="${GNUPGHOME:-$HOME/.gnupg}"
install -d -m 700 "$GNUPGHOME"

cat > "$GNUPGHOME/gpg.conf" <<EOF
use-agent
pinentry-mode loopback
EOF

cat > "$GNUPGHOME/gpg-agent.conf" <<EOF
allow-loopback-pinentry
default-cache-ttl 3600
max-cache-ttl 7200
EOF

# Pick up the new agent config.
gpgconf --kill all || true
gpg-connect-agent reloadagent /bye >/dev/null 2>&1 || true

# Import the armored key from the env var (avoids leaking it as an argv).
printf '%s' "$GPG_PRIVATE_KEY" | gpg --batch --import

# Sanity check.
if ! gpg --list-secret-keys --with-colons "$GPG_KEY_ID" \
     | awk -F: '$1=="sec" || $1=="ssb"' | grep -q .; then
  echo "✗ Imported keyring does not contain $GPG_KEY_ID" >&2
  gpg --list-secret-keys || true
  exit 1
fi

echo "✓ GPG key imported:"
gpg --list-secret-keys --keyid-format LONG "$GPG_KEY_ID"

