#!/usr/bin/env bash
# Pull latest code and rebuild running stack (run on the VPS).
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/consentmd-payments}"
BRANCH="${DEPLOY_BRANCH:-dev}"

cd "${APP_ROOT}"

export GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -F ${HOME}/.ssh/config -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new}"

git fetch origin "${BRANCH}"
git checkout "${BRANCH}"
git pull --ff-only origin "${BRANCH}"

if groups | grep -q docker; then
  docker compose -f deploy/docker-compose.server.yml up -d --build
else
  sudo docker compose -f deploy/docker-compose.server.yml up -d --build
fi

docker compose -f deploy/docker-compose.server.yml ps 2>/dev/null || \
  sudo docker compose -f deploy/docker-compose.server.yml ps
