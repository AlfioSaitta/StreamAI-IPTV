#!/usr/bin/env bash
# Build StreamAI Linux packages.
#
# Defaults to auto-detecting the host distribution via /etc/os-release and
# producing a native package tailored to that distro (correct dependency
# names, not just SONAMEs).
#
#   ID=opensuse-tumbleweed | opensuse-leap | sles    → opensuse (.rpm)
#   ID=fedora                                        → fedora   (.rpm)
#   ID=rhel | centos | rocky | almalinux             → rhel     (.rpm)
#   ID=debian                                        → debian   (.deb)
#   ID=ubuntu | linuxmint | pop                      → ubuntu   (.deb)
#   ID=arch | manjaro | endeavouros | cachyos        → arch     (.pkg.tar.zst)
#
# Per-distro flags (use the distro's native package names from
# build/depends/<distro>.json):
#   --opensuse  --fedora  --rhel  --debian  --ubuntu  --arch
#
# Generic flags (use SONAME virtual provides, more portable but less precise):
#   --deb       --rpm     --pacman
#
# Portable formats:
#   --appimage  --tar
#
# Convenience:
#   --all       Build every per-distro variant + AppImage + tar.xz
#
# Env overrides:
#   DISTROS=opensuse,fedora,debian   Per-distro jobs (comma-separated)
#   TARGET=deb,rpm,...               Generic targets (SONAME-based)
#   SKIP_BUILD=1                     Reuse existing dist/ contents
#   GPG_KEY_ID=...                   Sign every produced artefact when set
#   USE_DOCKER=auto|1|0              Force/disable container build
#   DOCKER_IMAGE=...                 Override the builder image
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

# Each JOB is "<distro>:<target>" where distro ∈
# opensuse | fedora | rhel | debian | ubuntu | arch | generic
# and target ∈ deb | rpm | pacman | AppImage | tar.xz
JOBS=()

add_job() {
  local job="$1"
  for existing in "${JOBS[@]:-}"; do
    [[ "$existing" == "$job" ]] && return 0
  done
  JOBS+=("$job")
}

distro_target() {
  case "$1" in
    opensuse|fedora|rhel) echo rpm ;;
    debian|ubuntu)        echo deb ;;
    arch)                 echo pacman ;;
    *)                    echo "" ;;
  esac
}

ALL_DISTROS=(opensuse fedora rhel debian ubuntu arch)
PORTABLE_TARGETS=(AppImage tar.xz)

# ---- Parse explicit flags --------------------------------------------------
for arg in "$@"; do
  case "$arg" in
    --opensuse) add_job "opensuse:rpm" ;;
    --fedora)   add_job "fedora:rpm" ;;
    --rhel)     add_job "rhel:rpm" ;;
    --debian)   add_job "debian:deb" ;;
    --ubuntu)   add_job "ubuntu:deb" ;;
    --arch)     add_job "arch:pacman" ;;
    --deb)      add_job "generic:deb" ;;
    --rpm)      add_job "generic:rpm" ;;
    --pacman)   add_job "generic:pacman" ;;
    --appimage) add_job "generic:AppImage" ;;
    --tar)      add_job "generic:tar.xz" ;;
    --all)
      for d in "${ALL_DISTROS[@]}"; do add_job "$d:$(distro_target "$d")"; done
      for t in "${PORTABLE_TARGETS[@]}"; do add_job "generic:$t"; done
      ;;
    -h|--help) sed -n '1,40p' "$0"; exit 0 ;;
    *) echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done

# ---- Env overrides ---------------------------------------------------------
if [[ ${#JOBS[@]} -eq 0 && -n "${DISTROS:-}" ]]; then
  IFS=',' read -ra _d <<<"$DISTROS"
  for d in "${_d[@]}"; do
    d="$(echo "$d" | tr '[:upper:]' '[:lower:]' | xargs)"
    t="$(distro_target "$d")"
    [[ -z "$t" ]] && { echo "Unknown distro in DISTROS=: $d" >&2; exit 2; }
    add_job "$d:$t"
  done
fi
if [[ ${#JOBS[@]} -eq 0 && -n "${TARGET:-}" ]]; then
  IFS=',' read -ra _t <<<"$TARGET"
  for t in "${_t[@]}"; do
    t="$(echo "$t" | tr '[:upper:]' '[:lower:]' | xargs)"
    case "$t" in
      deb|rpm|pacman) add_job "generic:$t" ;;
      appimage)       add_job "generic:AppImage" ;;
      tar|tar.xz)     add_job "generic:tar.xz" ;;
      *) echo "Unknown target in TARGET=: $t" >&2; exit 2 ;;
    esac
  done
fi

# ---- Auto-detect from /etc/os-release --------------------------------------
if [[ ${#JOBS[@]} -eq 0 ]]; then
  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    case "${ID:-}" in
      opensuse*|sles|suse)              add_job "opensuse:rpm" ;;
      fedora)                           add_job "fedora:rpm" ;;
      rhel|centos|rocky|almalinux)      add_job "rhel:rpm" ;;
      debian)                           add_job "debian:deb" ;;
      ubuntu|linuxmint|pop)             add_job "ubuntu:deb" ;;
      arch|manjaro|endeavouros|cachyos) add_job "arch:pacman" ;;
      *)
        case "${ID_LIKE:-}" in
          *debian*|*ubuntu*) add_job "debian:deb" ;;
          *fedora*|*rhel*)   add_job "fedora:rpm" ;;
          *suse*)            add_job "opensuse:rpm" ;;
          *arch*)            add_job "arch:pacman" ;;
          *)
            cat >&2 <<EOM
Unsupported host distribution: ID='${ID:-?}' ID_LIKE='${ID_LIKE:-?}'

Run explicitly one of:
  bash scripts/build-linux.sh --appimage   # universal portable
  bash scripts/build-linux.sh --tar        # portable tar.xz
  bash scripts/build-linux.sh --all        # produce everything
EOM
            exit 3 ;;
        esac ;;
    esac
  else
    echo "ERROR: /etc/os-release not readable." >&2
    exit 3
  fi
fi

echo "▶ Build jobs: ${JOBS[*]}"

# ---- Version sync (.version is the single source of truth) ----------------
# Propagates the base version from .version into package.json + android
# gradle, and prints the *effective* build version (base[_<sha>]) so the
# log makes the artefact naming convention obvious.
if [[ -x "$(command -v node)" ]]; then
  node "$SCRIPT_DIR/sync-version.mjs"
fi

# Resolve the short commit SHA passed down to make-distro-config so each
# per-distro artefact carries the build provenance in its filename, e.g.
# streamai-iptv_1.0.0_276ee32_debian_amd64.deb. The CI workflow sets
# COMMIT_SHA explicitly; locally we derive it from git when available.
COMMIT_SHORT="${COMMIT_SHA:-${GITHUB_SHA:-}}"
if [[ -z "$COMMIT_SHORT" ]] && command -v git >/dev/null 2>&1; then
  COMMIT_SHORT="$(git -C "$ROOT" rev-parse --short=7 HEAD 2>/dev/null || true)"
fi
COMMIT_SHORT="${COMMIT_SHORT:0:7}"

# ---- Vite build (skippable when iterating on packaging only) ---------------
if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  if [[ -d "$ROOT/dist" ]] && find "$ROOT/dist" -maxdepth 3 -not -user "$(id -un)" -print -quit 2>/dev/null | grep -q .; then
    echo "▶ Cleaning root-owned files left by previous Docker run (sudo needed)"
    sudo rm -rf "$ROOT/dist"
  fi
  echo "▶ Vite production build"
  ./node_modules/.bin/vite build
fi

# ---- Regenerate hicolor icons ----------------------------------------------
echo "▶ Regenerating desktop icons"
node scripts/generate-icons.mjs || echo "  (icon generation skipped)"

# ---- Docker fallback policy ------------------------------------------------
USE_DOCKER="${USE_DOCKER:-auto}"
DOCKER_IMAGE="${DOCKER_IMAGE:-electronuserland/builder:latest}"

needs_docker() {
  local t="$1"
  [[ "$USE_DOCKER" == "1" ]] && return 0
  [[ "$USE_DOCKER" == "0" ]] && return 1
  case "$t" in
    rpm)
      if command -v rpmbuild >/dev/null 2>&1; then
        local ver major minor
        ver="$(rpmbuild --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' | head -1)"
        major="${ver%%.*}"; minor="${ver##*.}"
        if [[ -n "$major" && ( "$major" -gt 4 || ( "$major" -eq 4 && "$minor" -ge 20 ) ) ]]; then
          return 0
        fi
        command -v fakeroot >/dev/null 2>&1 || return 0
        return 1
      fi
      return 0 ;;
    deb)
      command -v dpkg-deb >/dev/null 2>&1 || return 0
      command -v fakeroot >/dev/null 2>&1 || return 0
      return 1 ;;
    pacman)
      command -v xz >/dev/null 2>&1 || return 0
      return 1 ;;
    AppImage|tar.xz) return 1 ;;
  esac
  return 1
}

# ---- Single-target invocation (native or in Docker) ------------------------
run_eb() {
  local target="$1" config="${2:-}"
  if needs_docker "$target"; then
    if ! command -v docker >/dev/null 2>&1; then
      echo "✗ Docker required for '$target' but not installed." >&2; return 1
    fi
    if ! docker info >/dev/null 2>&1; then
      cat >&2 <<EOF
✗ Docker daemon not reachable. Start it with:
  sudo systemctl start docker
  sudo systemctl enable docker
  sudo usermod -aG docker \$USER  # then re-login
EOF
      return 1
    fi
    echo "▶ Building $target inside ${DOCKER_IMAGE}"
    local UID_GID="$(id -u):$(id -g)"
    local container_args=(./node_modules/.bin/electron-builder build --linux "$target" --publish never)
    if [[ -n "$config" ]]; then
      local rel="${config#$ROOT/}"
      container_args+=(--config "/project/${rel}")
    fi
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
               ${container_args[*]}"
  else
    local cmd=(./node_modules/.bin/electron-builder build --linux "$target" --publish never)
    [[ -n "$config" ]] && cmd+=(--config "$config")
    echo "▶ ${cmd[*]}"
    "${cmd[@]}"
  fi
}

# ---- Run all jobs ----------------------------------------------------------
mkdir -p "$ROOT/dist"
FAILED=()
for job in "${JOBS[@]}"; do
  distro="${job%%:*}"
  target="${job##*:}"
  echo
  echo "════════ Job: distro=${distro}  target=${target} ════════"
  if [[ "$distro" == "generic" ]]; then
    run_eb "$target" || FAILED+=("$job")
  else
    config_file="$ROOT/dist/.eb-config-${distro}.json"
    mkc_args=("$distro" "$target")
    [[ -n "$COMMIT_SHORT" ]] && mkc_args+=(--commit "$COMMIT_SHORT")
    node "$SCRIPT_DIR/make-distro-config.mjs" "${mkc_args[@]}" > "$config_file"
    run_eb "$target" "$config_file" || FAILED+=("$job")
  fi
done

if (( ${#FAILED[@]} )); then
  echo "✗ Failed jobs: ${FAILED[*]}" >&2
  exit 4
fi

# ---- Signing ---------------------------------------------------------------
if [[ -n "${GPG_KEY_ID:-}" ]]; then
  echo "▶ Signing artefacts with key ${GPG_KEY_ID}"
  bash "$SCRIPT_DIR/sign-linux-packages.sh"
else
  echo "ℹ GPG_KEY_ID not set — skipping signing."
fi

echo "✓ Linux build complete. Artefacts in dist/"
ls -lh dist/ | grep -E '\.(deb|rpm|pkg\.tar\.zst|AppImage|tar\.xz|asc|sig|SHA256SUMS)$' || true

