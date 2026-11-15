#!/usr/bin/env bash
# Runs TLC on a TLA+ spec. Downloads a pinned Temurin JRE and tla2tools.jar into
# verify/.cache on first use (checksums verified), so nothing is installed system-wide.
# Usage: verify/tlc.sh <dir>/<Spec>.tla [extra TLC args]
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
cache="$here/.cache"
jdk_release="jdk-21.0.5+11"
tla_version="1.7.4"
tla_sha="936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88"
mkdir -p "$cache"

jar="$cache/tla2tools-$tla_version.jar"
if [ ! -f "$jar" ]; then
  curl -fsSL -o "$jar.tmp" "https://github.com/tlaplus/tlaplus/releases/download/v$tla_version/tla2tools.jar"
  echo "$tla_sha  $jar.tmp" | shasum -a 256 -c - >/dev/null
  mv "$jar.tmp" "$jar"
fi

java="$(command -v java >/dev/null && java -version >/dev/null 2>&1 && command -v java || true)"
if [ -z "$java" ]; then
  jre="$cache/jre-$jdk_release"
  if [ ! -d "$jre" ]; then
    case "$(uname -s)" in Darwin) os=mac ;; Linux) os=linux ;; *) echo "unsupported OS" >&2; exit 1 ;; esac
    case "$(uname -m)" in arm64|aarch64) arch=aarch64 ;; x86_64) arch=x64 ;; *) echo "unsupported arch" >&2; exit 1 ;; esac
    meta="$(curl -fsSL "https://api.adoptium.net/v3/assets/release_name/eclipse/${jdk_release/+/%2B}?architecture=$arch&image_type=jre&os=$os&heap_size=normal&jvm_impl=hotspot")"
    link="$(jq -r '.binaries[0].package.link' <<<"$meta")"
    sha="$(jq -r '.binaries[0].package.checksum' <<<"$meta")"
    curl -fsSL -o "$cache/jre.tar.gz" "$link"
    echo "$sha  $cache/jre.tar.gz" | shasum -a 256 -c - >/dev/null
    mkdir -p "$jre.tmp" && tar -xzf "$cache/jre.tar.gz" -C "$jre.tmp" --strip-components=1
    rm "$cache/jre.tar.gz" && mv "$jre.tmp" "$jre"
  fi
  java="$( [ -x "$jre/Contents/Home/bin/java" ] && echo "$jre/Contents/Home/bin/java" || echo "$jre/bin/java")"
fi

spec="$1"; shift
cd "$(dirname "$spec")"
exec "$java" -XX:+UseParallelGC -cp "$jar" tlc2.TLC -workers auto -deadlock -metadir "$cache/states" "$(basename "$spec")" "$@"
