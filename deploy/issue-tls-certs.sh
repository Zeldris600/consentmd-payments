#!/usr/bin/env bash
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
    --cert-name "${domain}" || {
    echo "Warning: certificate not issued for ${domain} (check DNS)." >&2
    return 0
  }
}

issue_one orvix.consentmd.ai
issue_one orvix.staging.consentmd.ai

bash "${APP_ROOT}/deploy/sync-nginx-tls.sh"

echo "Verify:"
echo "  curl -sS https://orvix.consentmd.ai/api/health"
echo "  curl -sS https://orvix.staging.consentmd.ai/api/health"
