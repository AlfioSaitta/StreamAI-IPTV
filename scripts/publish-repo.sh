#!/usr/bin/env bash
# Assemble public-repo/ — the directory served on GitHub Pages — containing
# signed apt, rpm and arch repositories plus mirrored AppImage / tar.xz
# artefacts. Designed to run in CI on ubuntu-latest after build-linux.sh --all
# but can be invoked locally too (Docker required for the Arch repo step).
#
# Required env:
#   GPG_KEY_ID, GPG_PASSPHRASE  (signing key already imported into gpg-agent)
#   REPO_BASE_URL               public URL of the served repo, e.g.
#                               https://<user>.github.io/StreamAI-IPTV
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST="$ROOT/dist"
OUT="$ROOT/public-repo"
KEYS="$ROOT/docs/keys"
REPO_BASE_URL="${REPO_BASE_URL:-https://example.github.io/StreamAI-IPTV}"

: "${GPG_KEY_ID:?GPG_KEY_ID must be set}"

GPG_ARGS=(--batch --yes --pinentry-mode loopback -u "$GPG_KEY_ID")
if [[ -n "${GPG_PASSPHRASE:-}" ]]; then
  GPG_ARGS+=(--passphrase "$GPG_PASSPHRASE")
fi

FPR="$(cat "$KEYS/streamai-fingerprint.txt" 2>/dev/null || echo "$GPG_KEY_ID")"

mkdir -p "$OUT"/{apt,rpm,arch,appimage,tar}
cp -f "$KEYS/streamai-pubkey.asc" "$OUT/pubkey.asc"

# ============================================================================
# APT repository (Debian/Ubuntu) — single stable channel
# ============================================================================
if compgen -G "$DIST/*.deb" >/dev/null; then
  echo "▶ Building APT repo (stable)"
  APT="$OUT/apt"
  mkdir -p "$APT/conf"
  cat > "$APT/conf/distributions" <<EOF
Origin: StreamAI
Label: StreamAI
Codename: stable
Suite: stable
Architectures: amd64
Components: main
Description: StreamAI IPTV stable releases
SignWith: $GPG_KEY_ID
EOF
  (
    cd "$APT"
    for deb in "$DIST"/*.deb; do
      reprepro --ignore=wrongdistribution -b . includedeb stable "$deb"
    done
  )
fi

# ============================================================================
# RPM repository (Fedora/openSUSE/RHEL)
# ============================================================================
if compgen -G "$DIST/*.rpm" >/dev/null; then
  echo "▶ Building RPM repo"
  RPM="$OUT/rpm"
  cp "$DIST"/*.rpm "$RPM/"
  createrepo_c "$RPM"
  gpg "${GPG_ARGS[@]}" --armor --detach-sign --output "$RPM/repodata/repomd.xml.asc" "$RPM/repodata/repomd.xml"
  cat > "$RPM/streamai.repo" <<EOF
[streamai]
name=StreamAI IPTV
baseurl=${REPO_BASE_URL}/rpm
enabled=1
gpgcheck=1
repo_gpgcheck=1
gpgkey=${REPO_BASE_URL}/pubkey.asc
EOF
fi

# ============================================================================
# Arch repository — uses repo-add inside an Arch container
# ============================================================================
if compgen -G "$DIST/*.pkg.tar.zst" >/dev/null; then
  echo "▶ Building Arch repo (via archlinux:latest container)"
  ARCH="$OUT/arch"
  cp "$DIST"/*.pkg.tar.zst "$ARCH/"
  [[ -e "$DIST"/*.pkg.tar.zst.sig ]] && cp "$DIST"/*.pkg.tar.zst.sig "$ARCH/" || true

  if ! command -v docker >/dev/null 2>&1; then
    echo "  ✗ docker is required to run repo-add for the Arch repository." >&2
    exit 5
  fi

  docker run --rm \
    -v "$ARCH":/w \
    -w /w \
    archlinux:latest \
    bash -c "pacman -Sy --noconfirm --needed pacman-contrib && \
             repo-add streamai.db.tar.zst *.pkg.tar.zst"
fi

# ============================================================================
# AppImage + tar.xz mirrors
# ============================================================================
for f in "$DIST"/*.AppImage "$DIST"/*.AppImage.asc; do
  [[ -e "$f" ]] && cp "$f" "$OUT/appimage/"
done
for f in "$DIST"/*.tar.xz "$DIST"/*.tar.xz.asc; do
  [[ -e "$f" ]] && cp "$f" "$OUT/tar/"
done
[[ -e "$DIST/SHA256SUMS"     ]] && cp "$DIST/SHA256SUMS"     "$OUT/"
[[ -e "$DIST/SHA256SUMS.asc" ]] && cp "$DIST/SHA256SUMS.asc" "$OUT/"

# ============================================================================
# Landing page
# ============================================================================
cat > "$OUT/index.html" <<EOF
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>StreamAI IPTV — Linux repository</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:780px;margin:2rem auto;padding:0 1rem;background:#141414;color:#e5e7eb}
  h1,h2{color:#fff} code,pre{background:#1f1f1f;padding:.2em .4em;border-radius:6px}
  pre{padding:1rem;overflow:auto;border:1px solid #2a2a2a}
  a{color:#f87171}
</style>
</head>
<body>
<h1>StreamAI IPTV — Linux Repository</h1>
<p>Signed packages for Debian/Ubuntu, Fedora/openSUSE, Arch and portable AppImage/tar.xz.</p>
<p><strong>GPG fingerprint:</strong> <code>${FPR}</code><br>
<a href="pubkey.asc">Download public key</a></p>

<h2>Debian / Ubuntu</h2>
<pre>sudo install -d /etc/apt/keyrings
curl -fsSL ${REPO_BASE_URL}/pubkey.asc | sudo gpg --dearmor -o /etc/apt/keyrings/streamai.gpg
echo "deb [signed-by=/etc/apt/keyrings/streamai.gpg] ${REPO_BASE_URL}/apt stable main" \\
  | sudo tee /etc/apt/sources.list.d/streamai.list
sudo apt update && sudo apt install streamai</pre>

<h2>Fedora / RHEL / openSUSE</h2>
<pre>sudo rpm --import ${REPO_BASE_URL}/pubkey.asc
sudo curl -fsSL ${REPO_BASE_URL}/rpm/streamai.repo -o /etc/yum.repos.d/streamai.repo
sudo dnf install streamai      # or: sudo zypper in streamai</pre>

<h2>Arch / Manjaro / EndeavourOS</h2>
<pre>curl -fsSL ${REPO_BASE_URL}/pubkey.asc | sudo pacman-key -a -
sudo pacman-key --lsign-key ${FPR}
sudo tee -a /etc/pacman.conf > /dev/null <<'REPO'

[streamai]
Server = ${REPO_BASE_URL}/arch
REPO
sudo pacman -Sy streamai</pre>

<h2>Portable</h2>
<ul>
  <li><a href="appimage/">AppImage</a> (universal)</li>
  <li><a href="tar/">tar.xz</a> (extract anywhere)</li>
</ul>
</body>
</html>
EOF

echo "✓ public-repo ready at $OUT"

