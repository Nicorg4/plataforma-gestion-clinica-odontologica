#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SITE_ADDRESS="${1:-}"

fail() {
  echo "Error: $*" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail "ejecutar con sudo: sudo $0 <nombre-o-ip-del-servidor>"
[ -n "$SITE_ADDRESS" ] || fail "indicar el nombre o la IP con la que se va a abrir el sistema, por ejemplo: sudo $0 192.168.0.10"
[[ "$SITE_ADDRESS" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || fail "usar solo un nombre o una IPv4, sin esquema, puerto ni ruta"
. /etc/os-release
[ "${ID:-}" = "ubuntu" ] || fail "este script está pensado para Ubuntu Server (detectado: ${ID:-desconocido})"

if ! command -v docker >/dev/null 2>&1; then
  echo "Instalando Docker Engine y Compose..."
  apt-get update
  apt-get install -y --no-install-recommends ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y --no-install-recommends docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
docker compose version >/dev/null 2>&1 || fail "falta el plugin docker compose"
docker buildx version >/dev/null 2>&1 || fail "falta el plugin docker buildx"

cd "$REPO_DIR"
if [ ! -f .env ]; then
  umask 077
  password="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
  sed \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${password}|" \
    -e "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://sgo:${password}@localhost:5432/sgo|" \
    -e "s|^NODE_ENV=.*|NODE_ENV=production|" \
    -e "s|^SITE_ADDRESS=.*|SITE_ADDRESS=${SITE_ADDRESS}|" \
    -e "s|^PUBLIC_ORIGIN=.*|PUBLIC_ORIGIN=https://${SITE_ADDRESS}|" \
    .env.example > .env
  chmod 600 .env
  echo "Se creó .env con una clave de base de datos aleatoria."
else
  echo "Ya existe .env: se usa como está."
fi
chmod 600 .env

configured_site="$(sed -n 's/^SITE_ADDRESS=//p' .env)"
[ "$configured_site" = "$SITE_ADDRESS" ] || fail "SITE_ADDRESS de .env no coincide con el argumento; revisar .env antes de continuar"
port="$(sed -n 's/^HTTPS_PORT=//p' .env)"
port="${port:-443}"
[[ "$port" =~ ^[0-9]{1,5}$ ]] && (( 10#$port > 0 && 10#$port <= 65535 )) || fail "HTTPS_PORT inválido en .env"
origin="https://${SITE_ADDRESS}"
[ "$port" = 443 ] || origin="${origin}:${port}"
configured_origin="$(sed -n 's/^PUBLIC_ORIGIN=//p' .env)"
[ "$configured_origin" = "$origin" ] || fail "PUBLIC_ORIGIN de .env debe ser ${origin}"

docker compose up -d --build --wait
curl -ksf --resolve "${SITE_ADDRESS}:${port}:127.0.0.1" "https://${SITE_ADDRESS}:${port}/api/health" >/dev/null   || fail "el sistema no responde en /api/health"

echo
echo "Listo. Abrir ${origin} desde un equipo de la red."
code="$(docker compose logs backend 2>/dev/null | grep -o '"codigo":"[^"]*"' | tail -1 | cut -d'"' -f4 || true)"
if [ -n "$code" ]; then
  echo "Código de instalación para el asistente: ${code}"
fi
if docker compose cp proxy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt >/dev/null 2>&1; then
  echo "Certificado de la red local en $(pwd)/caddy-root.crt: instalarlo como autoridad de confianza en cada dispositivo."
else
  echo "No se pudo copiar el certificado: ver docs/deployment.md para obtenerlo manualmente." >&2
fi
