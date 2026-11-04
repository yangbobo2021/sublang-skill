#!/bin/sh
set -eu
skill_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
case "$(uname -s)" in Darwin) platform=darwin ;; Linux) platform=linux ;; *) echo 'SubLang Skill supports macOS and Linux.' >&2; exit 1 ;; esac
case "$(uname -m)" in arm64|aarch64) arch=arm64 ;; x86_64|amd64) arch=x64 ;; *) echo 'Unsupported CPU architecture.' >&2; exit 1 ;; esac
if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>23||(a===23&&b>=6)?0:1)' 2>/dev/null; then
  exec node "$skill_dir/scripts/setup.mjs"
fi
version=v25.5.0
archive="node-$version-$platform-$arch.tar.gz"
cache_dir="${SUBLANG_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/sublang-skill}"
node_dir="$cache_dir/node-$version-$platform-$arch"
if [ ! -x "$node_dir/bin/node" ]; then
  mkdir -p "$cache_dir"
  work_dir=$(mktemp -d "$cache_dir/.node-download.XXXXXX")
  trap 'rm -rf "$work_dir"' EXIT HUP INT TERM
  expected=$(awk -v archive="$archive" '$2 == archive {print $1}' "$skill_dir/runtime/node-checksums.txt")
  [ "${#expected}" -eq 64 ] || { echo 'No pinned Node checksum for this platform.' >&2; exit 1; }
  curl --fail --location --proto '=https' --tlsv1.2 --retry 2 "https://nodejs.org/dist/$version/$archive" -o "$work_dir/$archive" >&2
  if command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum "$work_dir/$archive" | awk '{print $1}'); else actual=$(shasum -a 256 "$work_dir/$archive" | awk '{print $1}'); fi
  [ "$actual" = "$expected" ] || { echo 'Node archive checksum mismatch.' >&2; exit 1; }
  tar -xzf "$work_dir/$archive" -C "$work_dir"
  # A competing setup may already have installed the same immutable runtime.
  if [ ! -d "$node_dir" ]; then mv "$work_dir/node-$version-$platform-$arch" "$node_dir"; fi
  rm -rf "$work_dir"
  trap - EXIT HUP INT TERM
fi
PATH="$node_dir/bin:$PATH" exec "$node_dir/bin/node" "$skill_dir/scripts/setup.mjs"
