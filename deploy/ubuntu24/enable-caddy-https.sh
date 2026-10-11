#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="nw-desertification"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DOMAIN=""
EMAIL=""
SITE_BASE="/var/www/$APP_NAME"
SKIP_PACKAGES=0
CADDYFILE="/etc/caddy/Caddyfile"

usage() {
  cat <<'EOF'
Usage: sudo bash deploy/ubuntu24/enable-caddy-https.sh --domain NAME [options]
  --domain NAME       Public domain whose A/AAAA record points to this server
  --email ADDRESS     Optional ACME account email
  --site-base PATH    Release base directory (default: /var/www/nw-desertification)
  --skip-packages     Skip apt package installation
  -h, --help          Show help
EOF
}

while (($#)); do
  case "$1" in
    --domain) DOMAIN="${2:?missing domain}"; shift 2 ;;
    --email) EMAIL="${2:?missing email}"; shift 2 ;;
    --site-base) SITE_BASE="${2:?missing site base}"; shift 2 ;;
    --skip-packages) SKIP_PACKAGES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ $EUID -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }
[[ "$DOMAIN" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$ ]] || {
  echo "A valid public domain is required; IP addresses cannot receive a normal public ACME certificate." >&2
  exit 2
}
[[ -z "$EMAIL" || "$EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || {
  echo "Invalid --email address" >&2
  exit 2
}
[[ "$SITE_BASE" =~ ^/[-A-Za-z0-9._/]+$ && "$SITE_BASE" != "/" ]] || {
  echo "Unsafe --site-base" >&2
  exit 2
}

SITE_ROOT="$SITE_BASE/current"
[[ -f "$SITE_ROOT/index.html" ]] || {
  echo "Missing deployed site: $SITE_ROOT/index.html" >&2
  echo "Run the site deployment first, then enable Caddy HTTPS." >&2
  exit 1
}

if (( ! SKIP_PACKAGES )); then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y caddy curl ca-certificates
fi
for cmd in caddy curl systemctl; do
  command -v "$cmd" >/dev/null || { echo "Missing: $cmd" >&2; exit 1; }
done

install -d -m 0755 /etc/caddy
BACKUP=""
if [[ -f "$CADDYFILE" ]]; then
  BACKUP="$CADDYFILE.backup.$(date -u +%Y%m%dT%H%M%SZ)"
  cp -a "$CADDYFILE" "$BACKUP"
fi

ACME_EMAIL_DIRECTIVE=""
[[ -z "$EMAIL" ]] || ACME_EMAIL_DIRECTIVE="    email $EMAIL"
TMP_CADDYFILE="$(mktemp /etc/caddy/Caddyfile.XXXXXX)"
sed \
  -e "s|__DOMAIN__|$DOMAIN|g" \
  -e "s|__ACME_EMAIL_DIRECTIVE__|$ACME_EMAIL_DIRECTIVE|g" \
  -e "s|__SITE_ROOT__|$SITE_ROOT|g" \
  "$SCRIPT_DIR/Caddyfile.template" > "$TMP_CADDYFILE"
chown root:root "$TMP_CADDYFILE"
chmod 0644 "$TMP_CADDYFILE"

rollback() {
  status=$?
  if (( status != 0 )); then
    echo "Caddy setup failed; restoring the previous web service." >&2
    rm -f "$TMP_CADDYFILE"
    if [[ -n "$BACKUP" && -f "$BACKUP" ]]; then
      cp -a "$BACKUP" "$CADDYFILE"
    else
      rm -f "$CADDYFILE"
    fi
    systemctl stop caddy >/dev/null 2>&1 || true
    if systemctl cat nginx.service >/dev/null 2>&1; then
      systemctl start nginx >/dev/null 2>&1 || true
    fi
  fi
  exit "$status"
}
trap rollback ERR

caddy validate --config "$TMP_CADDYFILE" --adapter caddyfile
mv -f "$TMP_CADDYFILE" "$CADDYFILE"

# Caddy must own ports 80 and 443 for ACME HTTP challenges and HTTPS traffic.
if systemctl cat nginx.service >/dev/null 2>&1; then
  systemctl disable --now nginx
fi
systemctl enable --now caddy
systemctl restart caddy

# Wait for automatic certificate issuance and verify the local TLS endpoint.
curl --noproxy '*' --retry 12 --retry-delay 5 --retry-all-errors \
  --fail --silent --show-error --resolve "$DOMAIN:443:127.0.0.1" \
  "https://$DOMAIN/healthz" >/dev/null

trap - ERR
echo "Caddy HTTPS enabled: https://$DOMAIN/"
echo "Certificate renewal is automatic while Caddy is running."
echo "Check status: systemctl status caddy --no-pager"
echo "Check logs: journalctl -u caddy -n 100 --no-pager"
