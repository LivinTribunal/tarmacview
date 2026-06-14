#!/usr/bin/env bash
# TarmacView - one-shot launcher for the offline field stack (macOS / Linux)
#
# Brings up the full docker compose "field" profile (backend + frontend +
# fieldhub + EMQX + MinIO) with zero hand-editing: detects the laptop's LAN
# IP, mints TLS via scripts/field-hub/gen-certs.sh, fills .env.docker
# non-destructively, and starts the stack. Safe to re-run - the CA and any
# existing secrets/creds are reused.
#
# Usage:
#   ./start-field.sh [LAN_IP]
#
# LAN_IP is the laptop's static address on the travel router (what DJI Pilot 2
# on the RC connects to). Omit it to auto-detect; pass it to pin a specific
# address, e.g. ./start-field.sh 192.168.8.100
set -euo pipefail

cd "$(dirname "$0")"

ENV_FILE=".env.docker"
GEN_CERTS="scripts/field-hub/gen-certs.sh"

echo "============================================================"
echo "  TarmacView - field stack starting up"
echo "============================================================"
echo

# .env.docker helpers - read/write single keys without clobbering the rest.
# secrets and creds land here only; the file is git-ignored, never logged.
env_get() {
    # prints the current value of a key (empty when unset or blank)
    local key="$1"
    [ -f "$ENV_FILE" ] || return 0
    sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1
}

env_set_force() {
    # adds or replaces a key
    local key="$1" val="$2"
    umask 077
    touch "$ENV_FILE"
    local tmp
    tmp="$(mktemp)"
    grep -v "^${key}=" "$ENV_FILE" > "$tmp" || true
    printf '%s=%s\n' "$key" "$val" >> "$tmp"
    cat "$tmp" > "$ENV_FILE"
    rm -f "$tmp"
}

env_set_if_empty() {
    # writes a key only when it is absent or blank - never clobbers a value
    local key="$1" val="$2"
    if [ -z "$(env_get "$key")" ]; then
        env_set_force "$key" "$val"
    fi
}

gen_secret() {
    # 256-bit random hex, mirrors start.sh's JWT generation
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex 32
    elif [ -r /dev/urandom ]; then
        head -c 48 /dev/urandom | base64 | tr -d '\n/+=' | head -c 64
    else
        echo "[ERROR] No random source available (openssl or /dev/urandom)." >&2
        exit 1
    fi
}

is_ipv4() {
    [[ "$1" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]
}

detect_ip() {
    # best-effort LAN IPv4 of the active interface (macOS then Linux)
    local ip=""
    if command -v ipconfig >/dev/null 2>&1; then
        local ifc
        for ifc in en0 en1 en2; do
            ip="$(ipconfig getifaddr "$ifc" 2>/dev/null || true)"
            [ -n "$ip" ] && { echo "$ip"; return 0; }
        done
    fi
    if command -v ip >/dev/null 2>&1; then
        ip="$(ip route get 1.1.1.1 2>/dev/null | sed -n 's/.*src \([0-9.]*\).*/\1/p' | head -n 1)"
        [ -n "$ip" ] && { echo "$ip"; return 0; }
    fi
    if command -v hostname >/dev/null 2>&1; then
        ip="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+\.' | head -n 1)"
        [ -n "$ip" ] && { echo "$ip"; return 0; }
    fi
    return 1
}

prompt_if_empty() {
    # carries an existing value; prompts when blank and a terminal is attached;
    # leaves blank otherwise (non-interactive runs stay hands-off)
    local key="$1" label="$2" secret="${3:-}"
    if [ -n "$(env_get "$key")" ]; then
        return 0
    fi
    if [ ! -t 0 ]; then
        return 0
    fi
    local val=""
    if [ "$secret" = "secret" ]; then
        read -r -s -p "  ${label} (blank to skip): " val
        echo
    else
        read -r -p "  ${label} (blank to skip): " val
    fi
    if [ -n "$val" ]; then
        env_set_force "$key" "$val"
    fi
}

# docker preflight - same checks as start.sh
if ! command -v docker >/dev/null 2>&1; then
    echo "[ERROR] Docker is not installed."
    echo "Install Docker Desktop from https://www.docker.com/products/docker-desktop/"
    exit 1
fi

if ! docker info >/dev/null 2>&1; then
    echo "[ERROR] Docker is installed but not running. Start Docker Desktop and try again."
    exit 1
fi

# resolve the LAN IP that the whole run agrees on (certs, device addrs, printed
# hub url). explicit $1 wins; else a stored host from a previous run is kept so
# re-runs stay consistent; else auto-detect for the first run.
IP_EXPLICIT=0
ARG_IP="${1:-}"
STORED_IP="$(env_get FIELDHUB_PUBLIC_HOST)"
if [ -n "$ARG_IP" ]; then
    if ! is_ipv4 "$ARG_IP"; then
        echo "[ERROR] '$ARG_IP' is not an IPv4 address. Pass the laptop's LAN IP, e.g. 192.168.8.100"
        exit 1
    fi
    HUB_IP="$ARG_IP"
    IP_EXPLICIT=1
elif [ -n "$STORED_IP" ]; then
    HUB_IP="$STORED_IP"
    DETECTED="$(detect_ip || true)"
    if [ -n "$DETECTED" ] && [ "$DETECTED" != "$STORED_IP" ]; then
        echo "Note: detected LAN IP ${DETECTED} differs from the stored ${STORED_IP}."
        echo "Keeping ${STORED_IP}. To switch, re-run: ./start-field.sh ${DETECTED}"
    fi
else
    HUB_IP="$(detect_ip || true)"
    if [ -z "$HUB_IP" ]; then
        echo "[ERROR] Could not auto-detect a LAN IP. Re-run with it explicitly:"
        echo "  ./start-field.sh 192.168.8.100"
        exit 1
    fi
fi
echo "Using LAN IP: ${HUB_IP}"
echo

# base secret the backend hard-requires (also generated by start.sh)
if [ -z "$(env_get JWT_SECRET)" ]; then
    env_set_force JWT_SECRET "$(gen_secret)"
fi

# shared secret for the backend <-> fieldhub service calls - generated once
if [ -z "$(env_get FIELDHUB_SHARED_SECRET)" ]; then
    env_set_force FIELDHUB_SHARED_SECRET "$(gen_secret)"
fi

# backend -> fieldhub proxy is auto-wired by docker-compose.field.yml (loaded
# in the compose command below), so FIELDHUB_URL/FIELDHUB_CA stay out of
# .env.docker - that keeps a plain `docker compose up` hub-free.

# device-facing addresses Pilot 2 connects to - derived from the LAN IP.
# an explicit IP arg updates them; a bare re-run keeps the stored values.
if [ "$IP_EXPLICIT" -eq 1 ]; then
    env_set_force FIELDHUB_PUBLIC_HOST "$HUB_IP"
    env_set_force FIELDHUB_MQTT_DEVICE_ADDR "ssl://${HUB_IP}:8883"
    env_set_force FIELDHUB_MINIO_DEVICE_ENDPOINT "http://${HUB_IP}:9000"
else
    env_set_if_empty FIELDHUB_PUBLIC_HOST "$HUB_IP"
    env_set_if_empty FIELDHUB_MQTT_DEVICE_ADDR "ssl://${HUB_IP}:8883"
    env_set_if_empty FIELDHUB_MINIO_DEVICE_ENDPOINT "http://${HUB_IP}:9000"
fi

# pilot + dji + minio creds: carry what is already set, prompt when a terminal
# is attached, otherwise leave blank (the connect page reports unconfigured)
env_set_if_empty FIELDHUB_PILOT_USERNAME "pilot"
echo "Field credentials (stored in ${ENV_FILE}, never shared or committed):"
prompt_if_empty FIELDHUB_PILOT_PASSWORD "Pilot login password" secret
prompt_if_empty FIELDHUB_DJI_APP_ID "DJI app id"
prompt_if_empty FIELDHUB_DJI_APP_KEY "DJI app key"
prompt_if_empty FIELDHUB_DJI_APP_LICENSE "DJI app license"
prompt_if_empty MINIO_ROOT_USER "MinIO root user"
prompt_if_empty MINIO_ROOT_PASSWORD "MinIO root password" secret
echo

# TLS material - reuses the CA across runs, regenerates service certs for the IP
echo "Generating TLS material for ${HUB_IP}..."
if [ ! -x "$GEN_CERTS" ]; then
    echo "[ERROR] ${GEN_CERTS} not found or not executable."
    exit 1
fi
"$GEN_CERTS" "$HUB_IP"
echo

echo "Building and starting the field stack (5-10 min on first run)..."
docker compose --env-file "$ENV_FILE" -f docker-compose.yml -f docker-compose.field.yml --profile field up -d --build
echo

echo "============================================================"
echo "  TarmacView field stack is up"
echo "============================================================"
echo "  Web app:        http://localhost"
echo "  DJI Pilot 2:    https://${HUB_IP}:8443"
echo
echo "  On each RC (once): install the local CA at certs/ca/ca.crt,"
echo "  then point Pilot 2's Cloud Service at the hub URL above."
echo

# nudge if optional creds are still blank - the connect page needs them
for key in FIELDHUB_PILOT_PASSWORD FIELDHUB_DJI_APP_ID FIELDHUB_DJI_APP_KEY FIELDHUB_DJI_APP_LICENSE; do
    if [ -z "$(env_get "$key")" ]; then
        echo "  Note: ${key} is empty - set it in ${ENV_FILE} before field use."
    fi
done
