#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cleanup() {
  jobs -p | xargs -r kill >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

cd "$ROOT_DIR/bill_gen_frontend"
python3 app.py &

cd "$ROOT_DIR/master_portal"
python3 app.py &

wait
