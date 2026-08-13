#!/usr/bin/env bash
#
# Generates `latest.json` from the current tag + the files we just built.
# Invoked by .github/workflows/release.yml AFTER the build step uploads
# assets to the release, so we can list them.
#
# Usage:
#   ./scripts/generate-latest-json.sh <tag-without-v> <repo> <release-url>
#
# Writes latest.json to the current directory.

set -euo pipefail

VERSION="${1:-}"
REPO="${2:-Ryuuzaki1412/adminpack-explorer}"
RELEASE_URL="${3:-https://github.com/${REPO}/releases/tag/v${VERSION}}"

if [[ -z "$VERSION" ]]; then
  echo "usage: $0 <version> <repo> <release-url>" >&2
  exit 1
fi

PUBLISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Pull assets already attached to this release so the JSON lists them.
# Requires GH_TOKEN in env. If unavailable, leave assets empty.
ASSETS_JSON='[]'
if command -v gh >/dev/null 2>&1 && [[ -n "${GH_TOKEN:-}" ]]; then
  if ASSETS_JSON="$(gh release view "v${VERSION}" --repo "${REPO}" \
        --json assets --jq '.assets | map({name: .name, url: .browserDownloadUrl, size: .size, contentType: .contentType})' 2>/dev/null)"; then
    :
  else
    ASSETS_JSON='[]'
  fi
fi

cat > latest.json <<EOF
{
  "version": "${VERSION}",
  "name": "AdminPack Explorer v${VERSION}",
  "publishedAt": "${PUBLISHED_AT}",
  "releaseUrl": "${RELEASE_URL}",
  "notesUrl": "${RELEASE_URL}",
  "repo": "${REPO}",
  "assets": ${ASSETS_JSON}
}
EOF

echo "wrote latest.json (version=${VERSION}, assets=$(echo "${ASSETS_JSON}" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))' 2>/dev/null || echo '?'))"
