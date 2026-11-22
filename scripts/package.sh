#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist"
VERSION="$(node -p "JSON.parse(require('fs').readFileSync('${ROOT_DIR}/manifest.json', 'utf8')).version")"
VERSIONED_ZIP="${DIST_DIR}/historycleaner-v${VERSION}.zip"
LATEST_ZIP="${DIST_DIR}/historycleaner.zip"

mkdir -p "${DIST_DIR}"
rm -f "${VERSIONED_ZIP}" "${LATEST_ZIP}"

(
  cd "${ROOT_DIR}"
  zip -r -X -q "${VERSIONED_ZIP}" \
    manifest.json \
    LICENSE \
    icons/ \
    src/ \
    -x "*.DS_Store" "*~"
)

cp "${VERSIONED_ZIP}" "${LATEST_ZIP}"
unzip -t -qq "${VERSIONED_ZIP}"

echo "Chrome Web Store package ready:"
echo "  - ${VERSIONED_ZIP}"
echo "  - ${LATEST_ZIP}"
