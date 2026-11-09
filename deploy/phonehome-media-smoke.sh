#!/usr/bin/env bash
# Post-deploy / CI smoke — static analog media invariants for bridged.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INDEX="$ROOT/bridged/src/index.mjs"

if [[ ! -f "$INDEX" ]]; then
  echo "media-smoke FAIL: missing $INDEX" >&2
  exit 1
fi

echo "==> bridged unit tests (media invariants)"
(cd "$ROOT/bridged" && npm test --silent)

echo "==> analog media source guard"
node --input-type=module -e "
import fs from 'node:fs';
import { validateAnalogMediaSource } from './bridged/src/analogMedia.mjs';
const source = fs.readFileSync('$INDEX', 'utf8');
const result = validateAnalogMediaSource(source);
if (!result.ok) {
  console.error('media-smoke FAIL:');
  for (const v of result.violations) console.error('  -', v);
  process.exit(1);
}
console.log('media-smoke PASS: analog media invariants OK');
"
