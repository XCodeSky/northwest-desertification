#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="nw-desertification"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
DOMAIN="_"
SITE_BASE="/var/www/$APP_NAME"
ENABLE_HTTPS=0
EMAIL=""
SKIP_PACKAGES=0

usage() {
  cat <<'EOF'
Usage: sudo bash deploy/ubuntu24/deploy.sh [options]
  --domain NAME       Nginx server_name (default: _)
  --site-base PATH    Release base directory
  --https             Configure Let's Encrypt HTTPS
  --email ADDRESS     Certificate email (required with --https)
  --skip-packages     Skip apt package installation
  -h, --help          Show help
Environment: TIANDITU_TK injects the browser-side Tianditu key.
EOF
}

while (($#)); do
  case "$1" in
    --domain) DOMAIN="${2:?missing domain}"; shift 2 ;;
    --site-base) SITE_BASE="${2:?missing site base}"; shift 2 ;;
    --https) ENABLE_HTTPS=1; shift ;;
    --email) EMAIL="${2:?missing email}"; shift 2 ;;
    --skip-packages) SKIP_PACKAGES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ $EUID -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }
[[ "$DOMAIN" == "_" || "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "Invalid domain" >&2; exit 2; }
[[ "$SITE_BASE" =~ ^/[-A-Za-z0-9._/]+$ && "$SITE_BASE" != "/" ]] || { echo "Unsafe --site-base" >&2; exit 2; }
if (( ENABLE_HTTPS )) && { [[ "$DOMAIN" == "_" ]] || [[ -z "$EMAIL" ]]; }; then
  echo "--https requires --domain and --email" >&2; exit 2
fi

if (( ! SKIP_PACKAGES )); then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y nginx rsync curl ca-certificates python3
fi
for cmd in nginx rsync curl python3; do command -v "$cmd" >/dev/null || { echo "Missing: $cmd" >&2; exit 1; }; done

python3 "$SOURCE_DIR/tools/validate_site.py" --root "$SOURCE_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE_DIR="$SITE_BASE/releases/$STAMP"
CURRENT_LINK="$SITE_BASE/current"
PREVIOUS_TARGET=""
[[ -L "$CURRENT_LINK" ]] && PREVIOUS_TARGET="$(readlink -f "$CURRENT_LINK" || true)"
install -d -m 0755 "$RELEASE_DIR"
rsync -a --delete --exclude '.git/' --exclude '__pycache__/' --exclude '*.pyc' --exclude 'release/' --exclude '*.tar.gz' --exclude '*.sha256' "$SOURCE_DIR/" "$RELEASE_DIR/"

if [[ -n "${TIANDITU_TK:-}" ]]; then
  RELEASE_CONFIG="$RELEASE_DIR/assets/js/config.js" TIANDITU_TK="$TIANDITU_TK" python3 - <<'PY'
import os
from pathlib import Path
p = Path(os.environ["RELEASE_CONFIG"])
text = p.read_text(encoding="utf-8")
old = "tk: ''"
if old not in text:
    raise SystemExit("Expected empty tk field was not found")
key = os.environ["TIANDITU_TK"].replace("\\", "\\\\").replace("'", "\\'")
p.write_text(text.replace(old, f"tk: '{key}'", 1), encoding="utf-8")
PY
fi

chown -R root:root "$RELEASE_DIR"
find "$RELEASE_DIR" -type d -exec chmod 0755 {} +
find "$RELEASE_DIR" -type f -exec chmod 0644 {} +
chmod 0755 "$RELEASE_DIR/deploy/ubuntu24/deploy.sh"

CONF_PATH="/etc/nginx/sites-available/$APP_NAME"
sed -e "s|__SERVER_NAME__|$DOMAIN|g" -e "s|__SITE_ROOT__|$CURRENT_LINK|g" "$SOURCE_DIR/deploy/ubuntu24/nginx-site.conf" > "$CONF_PATH"
ln -sfn "$CONF_PATH" "/etc/nginx/sites-enabled/$APP_NAME"
rm -f /etc/nginx/sites-enabled/default

TMP_LINK="$SITE_BASE/.current-$STAMP"
ln -s "$RELEASE_DIR" "$TMP_LINK"
mv -Tf "$TMP_LINK" "$CURRENT_LINK"
rollback() {
  status=$?
  if (( status != 0 )) && [[ -n "$PREVIOUS_TARGET" && -d "$PREVIOUS_TARGET" ]]; then
    ln -sfn "$PREVIOUS_TARGET" "$CURRENT_LINK"
    nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
  fi
  exit "$status"
}
trap rollback ERR

nginx -t
systemctl enable --now nginx
systemctl reload nginx
if (( ENABLE_HTTPS )); then
  (( SKIP_PACKAGES )) || apt-get install -y certbot python3-certbot-nginx
  command -v certbot >/dev/null || { echo "Certbot is required" >&2; exit 1; }
  certbot --nginx --non-interactive --agree-tos --redirect -m "$EMAIL" -d "$DOMAIN"
fi
curl --fail --silent --show-error -H "Host: $DOMAIN" http://127.0.0.1/healthz >/dev/null
trap - ERR
echo "Deployment complete: $RELEASE_DIR"
if (( ENABLE_HTTPS )); then echo "URL: https://$DOMAIN/"; elif [[ "$DOMAIN" != "_" ]]; then echo "URL: http://$DOMAIN/"; else echo "URL: http://<server-ip>/"; fi
