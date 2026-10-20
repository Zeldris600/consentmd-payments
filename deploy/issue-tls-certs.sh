#!/usr/bin/env bash
# Obtain Let's Encrypt certs (webroot) and enable HTTPS in nginx.
# Requires DNS A records → this VM and port 80 reachable from the internet.
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/consentmd-payments}"
EMAIL="${CERTBOT_EMAIL:-contact@consentmd.ai}"
WEBROOT="/var/www/certbot"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  SUDO=sudo
else
  SUDO=
fi

$SUDO apt-get update -y
$SUDO apt-get install -y certbot

$SUDO mkdir -p "${WEBROOT}"
$SUDO chmod 755 "${WEBROOT}"

cd "${APP_ROOT}"

issue_one() {
  local domain="$1"
  $SUDO certbot certonly --webroot -w "${WEBROOT}" \
    -d "${domain}" \
    --email "${EMAIL}" \
    --agree-tos \
    --non-interactive \
    --keep-until-expiring \
    --cert-name "${domain}"
}

issue_one payments.consentmd.com
issue_one payments.staging.consentmd.com

cp deploy/nginx/payments-ssl.conf.template deploy/nginx/conf.d/payments-ssl.conf
cp deploy/nginx/payments.http-redirect.conf deploy/nginx/conf.d/payments.conf

$SUDO docker compose -f deploy/docker-compose.server.yml up -d
$SUDO docker exec consentmd-payments-nginx nginx -s reload

echo "TLS enabled. Verify:"
echo "  curl -sS https://payments.consentmd.com/api/health"
echo "  curl -sS https://payments.staging.consentmd.com/api/health"
