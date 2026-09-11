#!/bin/sh
set -eu

image=${1:?usage: zenith-smoke.sh IMAGE}
container=

cleanup() {
    if [ -n "$container" ]; then
        docker rm -f "$container" >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT INT TERM

container=$(docker run --detach --publish 127.0.0.1::3000 "$image")
port=$(docker port "$container" 3000/tcp | sed 's/.*://')

attempt=0
while [ "$attempt" -lt 30 ]; do
    if body=$(curl --fail --silent --show-error "http://127.0.0.1:$port/") && printf '%s' "$body" | grep -Fq '<span class="wordmark">odzip</span>'; then
        exit 0
    fi
    attempt=$((attempt + 1))
    sleep 1
done

docker logs "$container"
exit 1
