#!/usr/bin/env bash
# One-time: GitHub deploy key + clone into /opt/consentmd-payments (preserves env files).
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/consentmd-payments}"
REPO="git@github.com:Zeldris600/consentmd-payments.git"
BRANCH="${DEPLOY_BRANCH:-dev}"
KEY="${HOME}/.ssh/consentmd_payments_deploy"

mkdir -p "${HOME}/.ssh"
chmod 700 "${HOME}/.ssh"

if [[ ! -f "${KEY}" ]]; then
  ssh-keygen -t ed25519 -f "${KEY}" -N "" -C "consentmd-payments-vm"
fi

echo "Add this deploy key to GitHub (repo → Settings → Deploy keys), read-only:"
echo "---"
cat "${KEY}.pub"
echo "---"
echo "Or run locally: gh api repos/Zeldris600/consentmd-payments/keys -f title=consentmd-payments-vm -f key=\"\$(cat ${KEY}.pub)\" -F read_only=true"

if ! grep -q "Host github.com-consentmd-payments" "${HOME}/.ssh/config" 2>/dev/null; then
  cat >>"${HOME}/.ssh/config" <<EOF

Host github.com-consentmd-payments
  HostName github.com
  User git
  IdentityFile ${KEY}
  IdentitiesOnly yes
EOF
  chmod 600 "${HOME}/.ssh/config"
fi

export GIT_SSH_COMMAND="ssh -i ${KEY} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"

ENV_BACKUP=""
if [[ -f "${APP_ROOT}/.env.prod" ]]; then
  ENV_BACKUP=$(mktemp -d)
  cp "${APP_ROOT}/.env.prod" "${ENV_BACKUP}/"
  cp "${APP_ROOT}/.env.staging" "${ENV_BACKUP}/"
fi

if [[ -d "${APP_ROOT}/.git" ]]; then
  echo "Git repo already present at ${APP_ROOT}; pulling ${BRANCH}."
  cd "${APP_ROOT}"
  git remote set-url origin "github.com-consentmd-payments:Zeldris600/consentmd-payments.git" || \
    git remote add origin "github.com-consentmd-payments:Zeldris600/consentmd-payments.git"
  git fetch origin "${BRANCH}"
  git checkout "${BRANCH}"
  git pull --ff-only origin "${BRANCH}"
else
  sudo rm -rf "${APP_ROOT}.bak" 2>/dev/null || true
  if [[ -d "${APP_ROOT}" ]]; then
    sudo mv "${APP_ROOT}" "${APP_ROOT}.bak"
  fi
  git clone --branch "${BRANCH}" "github.com-consentmd-payments:Zeldris600/consentmd-payments.git" "${APP_ROOT}"
fi

if [[ -n "${ENV_BACKUP}" ]]; then
  cp "${ENV_BACKUP}/.env.prod" "${APP_ROOT}/"
  cp "${ENV_BACKUP}/.env.staging" "${APP_ROOT}/"
  rm -rf "${ENV_BACKUP}"
fi

chmod +x "${APP_ROOT}/deploy/deploy.sh" "${APP_ROOT}/deploy/issue-tls-certs.sh" 2>/dev/null || true

echo "Clone complete. Deploy with: ${APP_ROOT}/deploy/deploy.sh"
