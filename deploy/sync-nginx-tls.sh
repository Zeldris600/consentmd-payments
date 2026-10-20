#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/consentmd-payments}"
cd "${APP_ROOT}"

PROD_CERT="/etc/letsencrypt/live/orvix.consentmd.ai/fullchain.pem"
STAGING_CERT="/etc/letsencrypt/live/orvix.staging.consentmd.ai/fullchain.pem"

rm -f deploy/nginx/conf.d/payments-ssl.conf deploy/nginx/conf.d/payments-ssl-staging.conf

if [[ -f "${PROD_CERT}" ]]; then
  cat >deploy/nginx/conf.d/payments-ssl.conf <<'EOF'
server {
    listen 443 ssl;
    http2 on;
    server_name orvix.consentmd.ai;

    ssl_certificate /etc/letsencrypt/live/orvix.consentmd.ai/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/orvix.consentmd.ai/privkey.pem;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 2m;

    location / {
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        proxy_pass http://payments_prod;
    }
}
EOF
  cp deploy/nginx/payments.http-prod-redirect.conf deploy/nginx/conf.d/payments-prod-http.conf
else
  cp deploy/nginx/payments.http-prod-proxy.conf deploy/nginx/conf.d/payments-prod-http.conf
fi

if [[ -f "${STAGING_CERT}" ]]; then
  cat >deploy/nginx/conf.d/payments-ssl-staging.conf <<'EOF'
server {
    listen 443 ssl;
    http2 on;
    server_name orvix.staging.consentmd.ai;

    ssl_certificate /etc/letsencrypt/live/orvix.staging.consentmd.ai/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/orvix.staging.consentmd.ai/privkey.pem;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 2m;

    location / {
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        proxy_pass http://payments_staging;
    }
}
EOF
  cp deploy/nginx/payments.http-staging-redirect.conf deploy/nginx/conf.d/payments-staging-http.conf
else
  cp deploy/nginx/payments.http-staging-proxy.conf deploy/nginx/conf.d/payments-staging-http.conf
fi

if [[ ! -f deploy/nginx/conf.d/payments-prod-http.conf ]]; then
  cp deploy/nginx/payments.http-prod-proxy.conf deploy/nginx/conf.d/payments-prod-http.conf
fi
if [[ ! -f deploy/nginx/conf.d/payments-staging-http.conf ]]; then
  cp deploy/nginx/payments.http-staging-proxy.conf deploy/nginx/conf.d/payments-staging-http.conf
fi

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  SUDO=sudo
else
  SUDO=
fi

$SUDO docker exec consentmd-payments-nginx nginx -t
$SUDO docker exec consentmd-payments-nginx nginx -s reload

echo "TLS sync complete."
