#!/usr/bin/env bash
# scripts/sign-and-package.sh
#
# Tauri 2's macOS bundler signs with `codesign --force --deep --sign -` for ad-hoc.
# This produces an INVALID signature on apps without sealed resources
# (resources are required by --deep but we have none), which makes Gatekeeper
# report the file as "damaged" (已损坏) instead of the friendlier
# "unidentified developer" (未识别开发者) dialog with a GUI "Open Anyway" path.
#
# This script:
#   1. Removes the invalid --deep signature
#   2. Re-signs the inner binary (no --deep)
#   3. Re-signs the .app bundle (no --deep)
#   4. Re-creates the .app.zip
#   5. Re-creates the DMG (unsigned container; no notarization)
#
# Result: a properly ad-hoc-signed app that triggers the "unidentified developer"
# Gatekeeper warning with the "Privacy & Security → Open Anyway" GUI path
# (no terminal commands required by the end user).
#
# Usage:
#   npm run tauri build
#   ./scripts/sign-and-package.sh
#   # then upload the regenerated .app.zip and DMG to GitHub release

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

APP_BUNDLE="src-tauri/target/release/bundle/macos/AdminPack Explorer.app"
APP_BINARY="$APP_BUNDLE/Contents/MacOS/adminpack-explorer"
TAURI_DMG="src-tauri/target/release/bundle/dmg/AdminPack Explorer_0.1.0_aarch64.dmg"
APP_ZIP="/tmp/AdminPack-Explorer-v2-AppleSilicon.app.zip"

if [ ! -d "$APP_BUNDLE" ]; then
    echo "ERROR: $APP_BUNDLE not found. Run 'npm run tauri build' first."
    exit 1
fi

echo ""
echo "============================================================"
echo "  AdminPack Explorer - post-build re-sign + repackage"
echo "============================================================"
echo ""

echo "[1/4] Remove Tauri's invalid --deep signature..."
codesign --remove-signature "$APP_BUNDLE" 2>/dev/null || true

echo "[2/4] Re-sign with proper ad-hoc (no --deep)..."
# IMPORTANT: sign inner binary FIRST, then the bundle. No --deep.
# --deep breaks ad-hoc on apps without resources; without --deep is valid.
codesign --force --sign - "$APP_BINARY"
codesign --force --sign - "$APP_BUNDLE"

echo ""
echo "    -> verify:"
codesign -dvv "$APP_BUNDLE" 2>&1 | grep -E "(Identifier|Signature=)" | head -3
echo ""

echo "[3/4] Re-create .app.zip..."
rm -f "$APP_ZIP"
cd "$(dirname "$APP_BUNDLE")"
zip -r "$APP_ZIP" "$(basename "$APP_BUNDLE")" -x "*.DS_Store" >/dev/null
cd "$PROJECT_ROOT"
echo "    -> $APP_ZIP  ($(stat -f%z "$APP_ZIP") bytes)"
echo ""

echo "[4/4] Re-create DMG (unsigned container)..."
mkdir -p /tmp/adminpack_dmg
rm -rf /tmp/adminpack_dmg/*
cp -R "$APP_BUNDLE" /tmp/adminpack_dmg/

# Use hdiutil (built into macOS). create-dmg is nicer but not always installed.
hdiutil create \
    -volname "AdminPack Explorer" \
    -srcfolder /tmp/adminpack_dmg \
    -ov \
    -format UDZO \
    "$TAURI_DMG" >/dev/null

echo "    -> $TAURI_DMG  ($(stat -f%z "$TAURI_DMG") bytes)"
echo ""
echo "Done. Both files now have proper ad-hoc signature."
echo "Users will see the standard 'unidentified developer' Gatekeeper"
echo "dialog -> Privacy & Security -> Open Anyway. No terminal needed."
echo ""
echo "To upload to GitHub release:"
echo "  - $APP_ZIP"
echo "  - $TAURI_DMG"
