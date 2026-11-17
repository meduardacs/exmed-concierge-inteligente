#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -d .venv ]]; then python -m venv .venv; fi
if [[ -x .venv/Scripts/python.exe ]]; then
  PYTHON=.venv/Scripts/python.exe
else
  PYTHON=.venv/bin/python
fi
"$PYTHON" -m pip install -r requirements.txt
"$PYTHON" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
