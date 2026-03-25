#!/bin/bash
# res_hub start script
# Usage: bash start.sh

cd "$(dirname "$0")"

echo "[res_hub] Checking PostgreSQL..."
if ! systemctl is-active --quiet postgresql; then
    echo "[res_hub] Starting PostgreSQL..."
    sudo systemctl start postgresql
fi

echo "[res_hub] Starting Node server..."
node server.js
