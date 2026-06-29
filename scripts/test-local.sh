#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

npm install
npm run typecheck
npm run build

python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r backend/requirements.txt -r backend/dev-requirements.txt
python -m compileall backend/app
PYTHONPATH=backend pytest backend/tests

sh -n triton/entrypoint.sh
docker compose config >/tmp/realtime-pose-triton-compose.yml
