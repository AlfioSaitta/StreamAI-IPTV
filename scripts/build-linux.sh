#!/usr/bin/env bash
# Build StreamAI Linux packages.
#
# Defaults to auto-detecting the host distribution via /etc/os-release and
# producing the most appropriate native package format:
#   debian / ubuntu / linuxmint / pop  → deb
#   fedora / rhel / centos / rocky     → rpm
#   opensuse* / suse / sles            → rpm
#   arch / manjaro / endeavouros       → pacman
#
# Flags (mutually exclusive, multiple allowed via --all):
#   --deb        Build only the .deb package
#   --rpm        Build only the .rpm package
#   --pacman     Build only the .pkg.tar.zst Arch package
#   --appimage   Build the portable AppImage (on-demand)
#   --tar        Build the portable tar.xz   (on-demand)
#   --all        Build deb + rpm + pacman + AppImage + tar.xz
#
# Env overrides:
#   TARGET=deb,rpm,...   Comma-separated list, takes precedence over auto-detect
#   SKIP_BUILD=1         Reuse existing dist/ contents
#   GPG_KEY_ID=...       If set, sign every produced artefact
#   USE_DOCKER=auto|1|0  Auto (default): docker is used per-target when the
#                        native packaging toolchain is missing or incompatible
#                        (e.g. rpmbuild >= 4.20 vs bundled fpm 1.9.3, or when
#                        dpkg-deb / makepkg are not installed on the host).
#   DOCKER_IMAGE=...     Override the builder image (default
#                        electronuserland/builder:latest)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

ALLOWED="deb rpm pacman appimage tar"
TARGETS=()

add_target() {
  local t="$1"
  for existing in "${TARGETS[@]:-}"; do
    [[ "$existing" == "$t" ]] && return 0
  done
  TARGETS+=("$t")
}

# Parse explicit flags first.
for arg in "$@"; do
  case "$arg" in
    --deb)      add_target deb ;;
    --rpm)      add_target rpm ;;
    --pacman)   add_target pacman ;;
    --appimage) add_target appimage ;;
    --tar)      add_target tar ;;
    --all)      for t in deb rpm pacman appimage tar; do add_target "$t"; done ;;
    -h|--help)
      sed -n '1,30p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done

# TARGET=... env overrides auto-detect (only when no flags given).
if [[ ${#TARGETS[@]} -eq 0 && -n "${TARGET:-}" ]]; then
  IFS=',' read -ra _t <<<"$TARGET"
  for t in "${_t[@]}"; do add_target "$(echo "$t" | tr '[:upper:]' '[:lower:]' | xargs)"; done
fi

# Auto-detect from /etc/os-release.
if [[ ${#TARGETS[@]} -eq 0 ]]; then
  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    ID_LOWER="${ID:-}"
    LIKE_LOWER="${ID_LIKE:-}"
    case "$ID_LOWER $LIKE_LOWER" in
      *debian*|*ubuntu*|*linuxmint*|*pop*) add_target deb ;;
      *fedora*|*rhel*|*centos*|*rocky*|*almalinux*) add_target rpm ;;
      *opensuse*|*suse*|*sles*) add_target rpm ;;
      *arch*|*manjaro*|*endeavouros*|*cachyos*) add_target pacman ;;
      *)
        cat >&2 <<EOM
Unsupported host distribution: ID='${ID:-?}' ID_LIKE='${ID_LIKE:-?}'

Run explicitly one of:
  bash scripts/build-linux.sh --appimage   # universal portable
  bash scripts/build-linux.sh --tar        # portable tar.xz
  bash scripts/build-linux.sh --all        # produce everything
EOM
        exit 3
        ;;
    esac
  else
    echo "ERROR: /etc/os-release not readable. Specify --deb/--rpm/--pacman/--appimage/--tar." >&2
    exit 3
  fi
fi

echo "▶ Building Linux targets: ${TARGETS[*]}"

# Map our short names to electron-builder target names.
declare -a EB_TARGETS=()
for t in "${TARGETS[@]}"; do
  case "$t" in
    deb)      EB_TARGETS+=(deb) ;;
    rpm)      EB_TARGETS+=(rpm) ;;
    pacman)   EB_TARGETS+=(pacman) ;;
    appimage) EB_TARGETS+=(AppImage) ;;
    tar)      EB_TARGETS+=(tar.xz) ;;
  esac
done

# 1. Vite build (skippable when iterating on packaging only).
if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  # Recover from a previous Docker run that wrote root-owned files into
  # dist/ (older versions of this script did not pass --user to docker).
  if [[ -d "$ROOT/dist" ]] && ! find "$ROOT/dist" -maxdepth 2 -not -user "$(id -un)" -print -quit | grep -q .; then
    : # all good
  elif [[ -d "$ROOT/dist" ]] && find "$ROOT/dist" -maxdepth 2 -not -user "$(id -un)" -print -quit 2>/dev/null | grep -q .; then
    echo "▶ Cleaning root-owned files left by previous Docker run (sudo needed)"
    sudo rm -rf "$ROOT/dist"
  fi
  echo "▶ Vite production build"
  ./node_modules/.bin/vite build
fi

# 2. Regenerate hicolor icons.
echo "▶ Regenerating desktop icons"
node scripts/generate-icons.mjs || echo "  (icon generation skipped)"

# 3. Invoke electron-builder for each target. Some packaging back-ends require
#    Linux tooling that may be missing (or incompatible) on the host; in that
#    case the target is built inside an electronuserland/builder container.
USE_DOCKER="${USE_DOCKER:-auto}"
DOCKER_IMAGE="${DOCKER_IMAGE:-electronuserland/builder:latest}"

# Returns 0 (true) when the host CANNOT build $1 natively.
needs_docker() {
  local t="$1"
  [[ "$USE_DOCKER" == "1" ]] && return 0
  [[ "$USE_DOCKER" == "0" ]] && return 1
  case "$t" in
    rpm)
      # rpm >= 4.20 (openSUSE Tumbleweed, Fedora 41+) breaks bundled fpm 1.9.3.
      if command -v rpmbuild >/dev/null 2>&1; then
        local ver major minor
        ver="$(rpmbuild --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' | head -1)"
        major="${ver%%.*}"; minor="${ver##*.}"
        if [[ -n "$major" && ( "$major" -gt 4 || ( "$major" -eq 4 && "$minor" -ge 20 ) ) ]]; then
          return 0
        fi
        # System has compatible rpmbuild, but bundled fpm still needs fakeroot.
        command -v fakeroot >/dev/null 2>&1 || return 0
        return 1
      fi
      return 0
      ;;
    deb)
      command -v dpkg-deb >/dev/null 2>&1 || return 0
      command -v fakeroot >/dev/null 2>&1 || return 0
      return 1
      ;;
    pacman)
      # electron-builder uses its bundled tooling for pacman; only needs xz.
      command -v xz >/dev/null 2>&1 || return 0
      return 1
      ;;
    AppImage|tar.xz)
      return 1 ;;
  esac
  return 1
}

run_in_docker() {
  local target="$1"
  if ! command -v docker >/dev/null 2>&1; then
    echo "✗ Docker is required to build '$target' on this host but is not installed." >&2
    return 1
  fi
  if ! docker info >/dev/null 2>&1; then
    cat >&2 <<EOF
✗ Docker daemon is not reachable (needed to build '$target' on this host).

Start it with:
  sudo systemctl start docker
  sudo systemctl enable docker   # optional, to start at boot
  sudo usermod -aG docker \$USER  # then re-login to run without sudo

Or rerun with USE_DOCKER=0 to force the native (broken) path, or pick a
different target (e.g. --appimage / --tar).
EOF
    return 1
  fi
  echo "▶ Building $target inside ${DOCKER_IMAGE}"
  # Run as the host UID/GID so the artefacts written under dist/ remain
  # owned by the invoking user (otherwise subsequent vite/electron-builder
  # runs on the host fail with EACCES when trying to clean dist/).
  local UID_GID="$(id -u):$(id -g)"
  docker run --rm \
    --user "$UID_GID" \
    --env HOME=/tmp \
    --env ELECTRON_CACHE=/tmp/.cache/electron \
    --env ELECTRON_BUILDER_CACHE=/tmp/.cache/electron-builder \
    -v "$ROOT":/project \
    -v "$HOME/.cache/electron":/tmp/.cache/electron \
    -v "$HOME/.cache/electron-builder":/tmp/.cache/electron-builder \
    -w /project \
    "$DOCKER_IMAGE" \
    bash -c "git config --global --add safe.directory /project && \
             ./node_modules/.bin/electron-builder build --linux ${target} --publish never"
}

FAILED=()
for t in "${EB_TARGETS[@]}"; do
  if needs_docker "$t"; then
    if ! run_in_docker "$t"; then
      FAILED+=("$t")
    fi
  else
    echo "▶ electron-builder build --linux ${t}"
    if ! ./node_modules/.bin/electron-builder build --linux "${t}" --publish never; then
      FAILED+=("$t")
    fi
  fi
done

if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo "✗ Failed targets: ${FAILED[*]}" >&2
  exit 4
fi

# 4. Sign every produced artefact when a key id is available.
if [[ -n "${GPG_KEY_ID:-}" ]]; then
  echo "▶ Signing artefacts with key ${GPG_KEY_ID}"
  bash "$SCRIPT_DIR/sign-linux-packages.sh"
else
  echo "ℹ GPG_KEY_ID not set — skipping signing."
fi

echo "✓ Linux build complete. Artefacts in dist/"
ls -lh dist/ | grep -E '\.(deb|rpm|pkg\.tar\.zst|AppImage|tar\.xz|asc|sig|SHA256SUMS)$' || true

