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

mkdir -p "$OUT"/{apt/debian,apt/ubuntu,rpm/opensuse,rpm/fedora,rpm/rhel,arch}
cp -f "$KEYS/streamai-pubkey.asc" "$OUT/pubkey.asc"

build_apt_channel() {
  local distro="$1"
  local channel_dir="$OUT/apt/$distro"
  local pattern="$DIST/*_${distro}_*.deb"
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
      # When the cache (or Releases fallback) restored a previous build
      # of the *same* package name+version, reprepro refuses to overwrite
      # the pool file because its hashes/size differ (timestamps embedded
      # in the .deb). Drop the existing entry from the distribution
      # first, then include the new one.
      pkg_name="$(dpkg-deb -f "$deb" Package)"
      reprepro -b . removepackage stable "$pkg_name" 2>/dev/null || true
      # Also wipe the pool file itself: removepackage only drops the
      # index entry, the orphan .deb in pool/ can still clash on the
      # next includedeb. `_listconfidentfiles` / `_forget` are reprepro
      # internals we don't want to touch, so just rm any stale pool
      # entry with the canonical name.
      pkg_ver="$(dpkg-deb -f "$deb" Version)"
      pkg_arch="$(dpkg-deb -f "$deb" Architecture)"
      letter="${pkg_name:0:1}"
      pool_file="pool/main/${letter}/${pkg_name}/${pkg_name}_${pkg_ver}_${pkg_arch}.deb"
      [[ -e "$pool_file" ]] && rm -f "$pool_file"
      reprepro --ignore=wrongdistribution -b . includedeb stable "$deb"
    done
  )
}

build_rpm_channel() {
  local distro="$1"
  local channel_dir="$OUT/rpm/$distro"
  local pattern="$DIST/*_${distro}_*.rpm"
  if ! compgen -G "$pattern" >/dev/null; then
    echo "ℹ No .rpm matching '${pattern##*/}' — skipping rpm/${distro}"
    return 0
  fi
  echo "▶ Building RPM channel: ${distro}"
  # If a previously-cached build dropped an .rpm with the *same*
  # filename here, replace it: createrepo_c regenerates the metadata
  # from whatever is in the directory.
  for rpm in $pattern; do
    cp -f "$rpm" "$channel_dir/$(basename "$rpm")"
  done
  createrepo_c --update "$channel_dir" 2>/dev/null || createrepo_c "$channel_dir"
  gpg "${GPG_ARGS[@]}" --armor --detach-sign --yes \
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

if compgen -G "$DIST/*_arch_*.pkg.tar.zst" >/dev/null; then
  echo "▶ Building Arch repo (via archlinux:latest container)"
  # Overwrite existing same-named packages from a previous cached run.
  cp -f "$DIST"/*_arch_*.pkg.tar.zst "$OUT/arch/"
  compgen -G "$DIST/*_arch_*.pkg.tar.zst.sig" >/dev/null && \
    cp -f "$DIST"/*_arch_*.pkg.tar.zst.sig "$OUT/arch/" || true
  if ! command -v docker >/dev/null 2>&1; then
    echo "  ✗ docker required for repo-add" >&2; exit 5
  fi
  # repo-add is idempotent: it replaces an existing entry of the same
  # (name, version) with the new file from arguments.
  docker run --rm -v "$OUT/arch":/w -w /w archlinux:latest \
    bash -c "pacman -Sy --noconfirm --needed pacman-contrib && \
             repo-add -R streamai.db.tar.zst *.pkg.tar.zst"
fi

HAS_APPIMAGE=0
HAS_TAR=0
for f in "$DIST"/*.AppImage "$DIST"/*.AppImage.asc; do
  if [[ -e "$f" ]]; then
    mkdir -p "$OUT/appimage"
    cp "$f" "$OUT/appimage/"
    HAS_APPIMAGE=1
  fi
done
for f in "$DIST"/*.tar.xz "$DIST"/*.tar.xz.asc; do
  if [[ -e "$f" ]]; then
    mkdir -p "$OUT/tar"
    cp "$f" "$OUT/tar/"
    HAS_TAR=1
  fi
done
[[ -e "$DIST/SHA256SUMS"     ]] && cp "$DIST/SHA256SUMS"     "$OUT/"
[[ -e "$DIST/SHA256SUMS.asc" ]] && cp "$DIST/SHA256SUMS.asc" "$OUT/"

PORTABLE_HTML=""
if (( HAS_APPIMAGE || HAS_TAR )); then
  PORTABLE_HTML="<h2>Portable</h2>
<ul>"
  (( HAS_APPIMAGE )) && PORTABLE_HTML+="
  <li><a href=\"appimage/\">AppImage</a> (universal, no install required)</li>"
  (( HAS_TAR )) && PORTABLE_HTML+="
  <li><a href=\"tar/\">tar.xz</a> (extract anywhere)</li>"
  PORTABLE_HTML+="
</ul>"
fi

INTRO="Signed native packages for Debian, Ubuntu, openSUSE, Fedora, RHEL/Rocky/AlmaLinux and Arch"
if (( HAS_APPIMAGE || HAS_TAR )); then
  INTRO+=", plus portable AppImage / tar.xz builds"
fi
INTRO+="."

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
<p>${INTRO}</p>
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

${PORTABLE_HTML}
</body>
</html>
EOF

echo "✓ public-repo ready at $OUT"

