#!/usr/bin/env bash
# Certbot renewal + nginx reload (install via cron: 0 3 * * * root /opt/consentmd-payments/deploy/renew-tls-certs.sh)
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  SUDO=sudo
else
  SUDO=
fi

$SUDO certbot renew --quiet --webroot -w /var/www/certbot
$SUDO docker exec consentmd-payments-nginx nginx -s reload
