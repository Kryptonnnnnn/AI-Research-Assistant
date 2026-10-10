#!/usr/bin/env bash
# Fresh database + uploads for every e2e run (migrated with the real Alembic revision), then serve the API.
set -euo pipefail
E2E_DIR=/tmp/ara-e2e
rm -rf "$E2E_DIR"
mkdir -p "$E2E_DIR"
cd "$(dirname "$0")/../../../backend"
.venv/bin/alembic upgrade head
exec .venv/bin/uvicorn app.main:app --port 8100
