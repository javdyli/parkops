#!/usr/bin/env bash
# Check a deployed ParkOps: health, staff sign-in page, driver portal, and (with HEALTH_TOKEN) cameras and integrations.
# Usage: bash scripts/check-live.sh https://parking.yourdomain.com [HEALTH_TOKEN]
set -euo pipefail
URL="${1:?Usage: check-live.sh <url> [health token]}"; TOK="${2:-}"
code() { curl -sS -o /dev/null -w '%{http_code}' "$1"; }
echo "health:        $(curl -sS "$URL/health${TOK:+?token=$TOK}")"
echo "staff sign-in: HTTP $(code "$URL/login")"
echo "driver portal: HTTP $(code "$URL/")"
echo "security:      $(curl -sSI "$URL/" | grep -i -E '^(strict-transport-security|content-security-policy|x-frame-options)' | cut -c1-60 | tr '\n' '|')"
