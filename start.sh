#!/bin/bash
# res_hub start script
# Usage: bash start.sh

cd "$(dirname "$0")"

echo "[res_hub] Starting Node server..."
echo "[res_hub] Ensure DATABASE_URL is set in your environment."

node server.js
