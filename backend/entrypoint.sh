#!/bin/sh

ensure_docker_network() {
    if [ -S /var/run/docker.sock ]; then
        NETWORK_NAME="${DOCKER_NETWORK:-agentrove-sandbox-net}"
        if ! docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
            echo "Creating Docker network: $NETWORK_NAME"
            docker network create "$NETWORK_NAME" 2>/dev/null || true
        fi
    fi
}

echo "Running database migrations..."
cd /app && python migrate.py || exit 1

ensure_docker_network

WORKERS=1

echo "Starting VNC server..."
start-vnc.sh &

echo "Starting API server..."
if [ -S /var/run/docker.sock ]; then
    echo "Docker socket detected, running as current user for Docker access..."
    exec sh -c "ulimit -s 65536 && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1 --log-level info --no-proxy-headers"
else
    exec gosu appuser sh -c "ulimit -s 65536 && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1 --log-level info --no-proxy-headers"
fi
