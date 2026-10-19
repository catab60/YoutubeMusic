#!/bin/bash

if command -v termux-wake-lock >/dev/null 2>&1; then
    termux-wake-lock
fi

LOCAL_IP=$(ip -4 addr show wlan0 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' || hostname -I 2>/dev/null | awk '{print $1}')
PORT=5000

echo "Starting TuneStream on port ${PORT}..."
echo "Local: http://localhost:${PORT}"
if [ -n "$LOCAL_IP" ]; then
    echo "Network: http://${LOCAL_IP}:${PORT}"
fi

python3 app.py
