#!/usr/bin/env bash
# Regenerates web/src/lib/metrics/__fixtures__/swift-golden.json from the ORIGINAL Swift engine.
# Usage: tools/swift-golden/generate.sh [path-to-health_monitor_ios]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
IOS_REPO="${1:-$ROOT/../github/health_monitor_ios}"
SRC="$IOS_REPO/HealthMonitor/Sources"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cp "$SRC/Models/DomainModels.swift" "$WORK/"
# Only change: expose private helpers so intermediate sub-scores can be recorded.
# 1) expose private helpers so intermediate sub-scores can be recorded
# 2) replace the wall clock with a fixed clock so vectors are reproducible
sed -e 's/private static func/static func/g' -e 's/Date()/GoldenClock.now/g' \
  "$SRC/Services/DerivedMetricsEngine.swift" > "$WORK/DerivedMetricsEngine.swift"
cp "$HERE/main.swift" "$WORK/main.swift"

COMMIT="$(git -C "$IOS_REPO" rev-parse HEAD)"
swiftc -O -o "$WORK/golden" "$WORK/DomainModels.swift" "$WORK/DerivedMetricsEngine.swift" "$WORK/main.swift"
OUT_DIR="$ROOT/web/tests/fixtures"
mkdir -p "$OUT_DIR"
# Two time zones: Sydney (AEDT) and New York (DST ends 2026-11-01, inside the 28-day window).
for tz in Australia/Sydney America/New_York; do
  name="swift-golden-$(echo "$tz" | tr '/' '-' | tr 'A-Z' 'a-z').json"
  SOURCE_COMMIT="$COMMIT" TZ="$tz" "$WORK/golden" > "$OUT_DIR/$name"
  echo "wrote $OUT_DIR/$name (source commit $COMMIT, TZ=$tz)"
done
