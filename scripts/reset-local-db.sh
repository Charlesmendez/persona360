#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

rm -rf "$ROOT_DIR/.persona360"
rm -f "$ROOT_DIR/persona360.config.json"

cd "$ROOT_DIR"
pnpm persona init --json
