#!/usr/bin/env bash
set -Eeuo pipefail

REPOSITORY="XCodeSky/northwest-desertification"
RELEASE="v1.0.0"
DOMAIN="_"
SITE_BASE="/var/www/nw-desertification"
ENABLE_HTTPS=0
EMAIL=""
SKIP_PACKAGES=0

usage() {
  cat <<'EOF'
Download a verified GitHub Release and deploy it on Ubuntu 24.04.

Usage: sudo bash deploy-from-github.sh [options]
  --release TAG       GitHub release tag (default: v1.0.0)
  --domain NAME       Nginx server_name (default: _, for server IP access)
  --site-base PATH    Release base directory (default: /var/www/nw-desertification)
  --https             Configure Let's Encrypt HTTPS
  --email ADDRESS     Certificate email (required with --https)
  --skip-packages     Skip apt installation in the bundled deploy script
  -h, --help          Show this help

Environment: TIANDITU_TK is forwarded to the bundled deployment script.
EOF
}

while (($#)); do
  case "$1" in
    --release) RELEASE="${2:?missing release tag}"; shift 2 ;;
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
[[ "$RELEASE" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$ ]] || {
  echo "Invalid --release tag: $RELEASE" >&2; exit 2;
}
[[ "$DOMAIN" == "_" || "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || {
  echo "Invalid --domain value" >&2; exit 2;
}
[[ "$SITE_BASE" =~ ^/[-A-Za-z0-9._/]+$ && "$SITE_BASE" != "/" ]] || {
  echo "Unsafe --site-base value" >&2; exit 2;
}
if (( ENABLE_HTTPS )) && { [[ "$DOMAIN" == "_" ]] || [[ -z "$EMAIL" ]]; }; then
  echo "--https requires --domain and --email" >&2; exit 2
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y curl ca-certificates tar coreutils

VERSION="${RELEASE#v}"
ARCHIVE="northwest-desertification-site-$VERSION.tar.gz"
CHECKSUM="$ARCHIVE.sha256"
DOWNLOAD_BASE="https://github.com/$REPOSITORY/releases/download/$RELEASE"
WORK_DIR="$(mktemp -d -t nw-desertification.XXXXXXXX)"
trap 'rm -rf -- "$WORK_DIR"' EXIT

download_file() {
  local url="$1"
  local output="$2"
  curl --http1.1 --fail --location --show-error \
    --retry 8 --retry-delay 2 --retry-all-errors \
    --connect-timeout 20 --speed-limit 1024 --speed-time 60 \
    --continue-at - "$url" -o "$output"
}

echo "Downloading $REPOSITORY $RELEASE over HTTP/1.1..."
download_file "$DOWNLOAD_BASE/$ARCHIVE" "$WORK_DIR/$ARCHIVE"
download_file "$DOWNLOAD_BASE/$CHECKSUM" "$WORK_DIR/$CHECKSUM"

echo "Verifying SHA-256..."
(cd "$WORK_DIR" && sha256sum --check "$CHECKSUM")

mkdir "$WORK_DIR/extracted"
tar -xzf "$WORK_DIR/$ARCHIVE" -C "$WORK_DIR/extracted"
SOURCE_DIR="$WORK_DIR/extracted/website"
DEPLOY_SCRIPT="$SOURCE_DIR/deploy/ubuntu24/deploy.sh"
[[ -f "$DEPLOY_SCRIPT" && -f "$SOURCE_DIR/tools/validate_site.py" ]] || {
  echo "The release archive does not contain the expected website layout." >&2
  exit 1
}

DEPLOY_ARGS=(--domain "$DOMAIN" --site-base "$SITE_BASE")
(( ENABLE_HTTPS )) && DEPLOY_ARGS+=(--https --email "$EMAIL")
(( SKIP_PACKAGES )) && DEPLOY_ARGS+=(--skip-packages)

echo "Deploying to $SITE_BASE..."
bash "$DEPLOY_SCRIPT" "${DEPLOY_ARGS[@]}"
echo "Verified GitHub release deployed: $REPOSITORY@$RELEASE"
