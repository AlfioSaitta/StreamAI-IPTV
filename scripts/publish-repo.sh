#!/usr/bin/env bash
# Assemble public-repo/ — the directory served on GitHub Pages — with
# per-distribution APT and RPM channels, an Arch repository, and mirrors
# for the portable AppImage / tar.xz artefacts.
#
# Layout produced (each path is a fully working package repo):
#   public-repo/apt/debian/    Debian stable channel
#   public-repo/apt/ubuntu/    Ubuntu stable channel
#   public-repo/rpm/opensuse/  openSUSE channel
#   public-repo/rpm/fedora/    Fedora channel
#   public-repo/rpm/rhel/      RHEL / Rocky / AlmaLinux channel
#   public-repo/arch/          Arch / Manjaro / EndeavourOS channel
#   public-repo/appimage/      AppImage mirror
#   public-repo/tar/           tar.xz mirror
#   public-repo/pubkey.asc     Maintainer GPG public key
#   public-repo/index.html     Landing page with install snippets
#
# Required env:
#   GPG_KEY_ID, GPG_PASSPHRASE  Signing material (imported in current gpg)
#   REPO_BASE_URL               Public URL, e.g.
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

mkdir -p "$OUT"/{apt/debian,apt/ubuntu,rpm/opensuse,rpm/fedora,rpm/rhel,arch,appimage,tar}
cp -f "$KEYS/streamai-pubkey.asc" "$OUT/pubkey.asc"

build_apt_channel() {
  local distro="$1"
  local channel_dir="$OUT/apt/$distro"
  local pattern="$DIST/*-${distro}.*.deb"
  if ! compgen -G "$pattern" >/dev/null; then
    echo "ℹ No .deb matching '${pattern##*/}' — skipping apt/${distro}"
    return 0
  fi
  echo "▶ Building APT channel: ${distro}/stable"
  mkdir -p "$channel_dir/conf"
  cat > "$channel_dir/conf/distributions" <<EOF
Origin: StreamAI
Label: StreamAI ${distro}
Codename: stable
Suite: stable
Architectures: amd64
Components: main
Description: StreamAI IPTV stable releases (${distro})
SignWith: $GPG_KEY_ID
EOF
  (
    cd "$channel_dir"
    for deb in $pattern; do
      reprepro --ignore=wrongdistribution -b . includedeb stable "$deb"
    done
  )
}

build_rpm_channel() {
  local distro="$1"
  local channel_dir="$OUT/rpm/$distro"
  local pattern="$DIST/*-${distro}.*.rpm"
  if ! compgen -G "$pattern" >/dev/null; then
    echo "ℹ No .rpm matching '${pattern##*/}' — skipping rpm/${distro}"
    return 0
  fi
  echo "▶ Building RPM channel: ${distro}"
  cp $pattern "$channel_dir/"
  createrepo_c "$channel_dir"
  gpg "${GPG_ARGS[@]}" --armor --detach-sign \
    --output "$channel_dir/repodata/repomd.xml.asc" \
    "$channel_dir/repodata/repomd.xml"
  cat > "$channel_dir/streamai.repo" <<EOF
[streamai]
name=StreamAI IPTV (${distro})
baseurl=${REPO_BASE_URL}/rpm/${distro}
enabled=1
gpgcheck=1
repo_gpgcheck=1
gpgkey=${REPO_BASE_URL}/pubkey.asc
EOF
}

build_apt_channel debian
build_apt_channel ubuntu
build_rpm_channel opensuse
build_rpm_channel fedora
build_rpm_channel rhel

if compgen -G "$DIST/*-arch.*.pkg.tar.zst" >/dev/null; then
  echo "▶ Building Arch repo (via archlinux:latest container)"
  cp "$DIST"/*-arch.*.pkg.tar.zst "$OUT/arch/"
  compgen -G "$DIST/*-arch.*.pkg.tar.zst.sig" >/dev/null && \
    cp "$DIST"/*-arch.*.pkg.tar.zst.sig "$OUT/arch/" || true
  if ! command -v docker >/dev/null 2>&1; then
    echo "  ✗ docker required for repo-add" >&2; exit 5
  fi
  docker run --rm -v "$OUT/arch":/w -w /w archlinux:latest \
    bash -c "pacman -Sy --noconfirm --needed pacman-contrib && \
             repo-add streamai.db.tar.zst *.pkg.tar.zst"
fi

for f in "$DIST"/*.AppImage "$DIST"/*.AppImage.asc; do
  [[ -e "$f" ]] && cp "$f" "$OUT/appimage/"
done
for f in "$DIST"/*.tar.xz "$DIST"/*.tar.xz.asc; do
  [[ -e "$f" ]] && cp "$f" "$OUT/tar/"
done
[[ -e "$DIST/SHA256SUMS"     ]] && cp "$DIST/SHA256SUMS"     "$OUT/"
[[ -e "$DIST/SHA256SUMS.asc" ]] && cp "$DIST/SHA256SUMS.asc" "$OUT/"

cat > "$OUT/index.html" <<EOF
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>StreamAI IPTV — Linux repository</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:840px;margin:2rem auto;padding:0 1rem;background:#141414;color:#e5e7eb;line-height:1.55}
  h1,h2{color:#fff} code,pre{background:#1f1f1f;padding:.2em .4em;border-radius:6px}
  pre{padding:1rem;overflow:auto;border:1px solid #2a2a2a;font-size:.9rem}
  a{color:#f87171}
</style>
</head>
<body>
<h1>StreamAI IPTV — Linux Repository</h1>
<p>Signed native packages for Debian, Ubuntu, openSUSE, Fedora, RHEL/Rocky/AlmaLinux and Arch, plus portable AppImage / tar.xz builds.</p>
<p><strong>GPG fingerprint:</strong> <code>${FPR}</code><br>
<a href="pubkey.asc">Download public key</a></p>

<h2>Debian</h2>
<pre>sudo install -d /etc/apt/keyrings
curl -fsSL ${REPO_BASE_URL}/pubkey.asc | sudo gpg --dearmor -o /etc/apt/keyrings/streamai.gpg
echo "deb [signed-by=/etc/apt/keyrings/streamai.gpg] ${REPO_BASE_URL}/apt/debian stable main" \\
  | sudo tee /etc/apt/sources.list.d/streamai.list
sudo apt update && sudo apt install streamai</pre>

<h2>Ubuntu / Linux Mint / Pop!_OS</h2>
<pre>sudo install -d /etc/apt/keyrings
curl -fsSL ${REPO_BASE_URL}/pubkey.asc | sudo gpg --dearmor -o /etc/apt/keyrings/streamai.gpg
echo "deb [signed-by=/etc/apt/keyrings/streamai.gpg] ${REPO_BASE_URL}/apt/ubuntu stable main" \\
  | sudo tee /etc/apt/sources.list.d/streamai.list
sudo apt update && sudo apt install streamai</pre>

<h2>openSUSE Tumbleweed / Leap</h2>
<pre>sudo rpm --import ${REPO_BASE_URL}/pubkey.asc
sudo zypper addrepo ${REPO_BASE_URL}/rpm/opensuse streamai
sudo zypper refresh && sudo zypper install streamai</pre>

<h2>Fedora</h2>
<pre>sudo rpm --import ${REPO_BASE_URL}/pubkey.asc
sudo curl -fsSL ${REPO_BASE_URL}/rpm/fedora/streamai.repo -o /etc/yum.repos.d/streamai.repo
sudo dnf install streamai</pre>

<h2>RHEL / Rocky / AlmaLinux</h2>
<pre>sudo rpm --import ${REPO_BASE_URL}/pubkey.asc
sudo curl -fsSL ${REPO_BASE_URL}/rpm/rhel/streamai.repo -o /etc/yum.repos.d/streamai.repo
sudo dnf install streamai</pre>

<h2>Arch / Manjaro / EndeavourOS / CachyOS</h2>
<pre>curl -fsSL ${REPO_BASE_URL}/pubkey.asc | sudo pacman-key -a -
sudo pacman-key --lsign-key ${FPR}
sudo tee -a /etc/pacman.conf > /dev/null <<'REPO'

[streamai]
Server = ${REPO_BASE_URL}/arch
REPO
sudo pacman -Sy streamai</pre>

<h2>Portable</h2>
<ul>
  <li><a href="appimage/">AppImage</a> (universal, no install required)</li>
  <li><a href="tar/">tar.xz</a> (extract anywhere)</li>
</ul>
</body>
</html>
EOF

echo "✓ public-repo ready at $OUT"

