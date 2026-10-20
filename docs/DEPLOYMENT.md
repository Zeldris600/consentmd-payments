# VPS deployment (prod + staging)

Target host: GCE VM `consentmd-payments` (`consentmd-plus`, `us-central1-a`).

## One-time VM setup

```bash
gcloud compute ssh --zone us-central1-a consentmd-payments --project consentmd-plus
```

```bash
sudo bash /opt/consentmd-payments/deploy/bootstrap-vps.sh
# Re-login so `docker` group applies
exit
```

## Git deploy key (one-time)

On the VM, after the deploy key is registered on GitHub:

```bash
bash /opt/consentmd-payments/deploy/setup-git-deploy.sh
/opt/consentmd-payments/deploy/deploy.sh
```

Register the key from your workstation (example):

```bash
PUB=$(gcloud compute ssh consentmd-payments --zone us-central1-a --project consentmd-plus \
  --command 'cat ~/.ssh/consentmd_payments_deploy.pub')
gh api repos/Zeldris600/consentmd-payments/keys \
  -f title=consentmd-payments-vm \
  -f key="$PUB" \
  -F read_only=true
```

## Application layout

```text
/opt/consentmd-payments/          # git clone (branch dev)
  .env.prod                       # secrets (not in git)
  .env.staging                    # secrets (not in git)
  deploy/docker-compose.server.yml
  deploy/deploy.sh                # git pull + compose up --build
  deploy/issue-tls-certs.sh       # Let's Encrypt (after DNS)
```

Copy examples and fill values:

```bash
cp .env.prod.example .env.prod
cp .env.staging.example .env.staging
```

## DNS

| Host | Environment |
|------|-------------|
| `payments.consentmd.com` | Production |
| `payments.staging.consentmd.com` | Staging |

A records → VM external IP:

```bash
gcloud compute instances describe consentmd-payments \
  --zone us-central1-a --project consentmd-plus \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)'
```

Stripe webhook URLs (HTTPS after TLS):

- Prod: `https://payments.consentmd.com/api/webhooks/stripe`
- Staging: `https://payments.staging.consentmd.com/api/webhooks/stripe`

## Deploy / update

```bash
/opt/consentmd-payments/deploy/deploy.sh
```

## TLS (Let's Encrypt)

After DNS points at the VM:

```bash
sudo bash /opt/consentmd-payments/deploy/issue-tls-certs.sh
```

Optional daily renewal (cron as root):

```text
0 3 * * * /opt/consentmd-payments/deploy/renew-tls-certs.sh
```

Until TLS is issued, the app is served over HTTP on port 80 (Host header routing via nginx).
