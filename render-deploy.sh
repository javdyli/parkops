#!/usr/bin/env bash
# Create (or update) the ParkOps web service on Render from this repository, without clicking through the dashboard.
# The one-click alternative is the Blueprint link printed by scripts/github-push.sh; this script is for automation.
#
# Needs: curl, and
#   RENDER_API_KEY   from Render → Account settings → API keys
#   REPO             the GitHub repository URL, e.g. https://github.com/you/parkops (Render must have access to it:
#                    Render dashboard → Account → GitHub → install the Render app on that repository)
#   ADMIN_EMAIL / ADMIN_PASSWORD   the owner login (password 10+ characters)
# Optional: SERVICE_NAME (parkops), REGION (oregon|ohio|virginia|frankfurt|singapore), PLAN (starter), PUBLIC_URL,
#           SQUARE_*, RESEND_API_KEY, EMAIL_FROM, TWILIO_* — any that are set are passed to the service.
# Usage: RENDER_API_KEY=rnd_xxx REPO=https://github.com/you/parkops ADMIN_EMAIL=you@x.com ADMIN_PASSWORD=... bash scripts/render-deploy.sh
set -euo pipefail
: "${RENDER_API_KEY:?Set RENDER_API_KEY}"; : "${REPO:?Set REPO to the GitHub repository URL}"
: "${ADMIN_EMAIL:?Set ADMIN_EMAIL}"; : "${ADMIN_PASSWORD:?Set ADMIN_PASSWORD (10+ characters)}"
[ "${#ADMIN_PASSWORD}" -ge 10 ] || { echo "ADMIN_PASSWORD must be at least 10 characters" >&2; exit 1; }
NAME="${SERVICE_NAME:-parkops}"; REGION="${REGION:-oregon}"; PLAN="${PLAN:-starter}"
API="https://api.render.com/v1"; H=(-H "Authorization: Bearer $RENDER_API_KEY" -H "Content-Type: application/json" -H "Accept: application/json")
json_get() { python3 -c 'import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))' "$1"; }
OWNER=$(curl -sS "${H[@]}" "$API/owners?limit=20" | json_get 'next(o["owner"]["id"] for o in d if o["owner"]["type"] in ("user","team"))')
echo "Render owner: $OWNER"
env_json() { python3 - "$@" <<'EOF'
import json,os,sys
keys=['DATA_DIR','ADMIN_EMAIL','ADMIN_PASSWORD','ADMIN_NAME','PUBLIC_URL','TRUST_PROXY','SQUARE_ENVIRONMENT','SQUARE_ACCESS_TOKEN','SQUARE_APPLICATION_ID','SQUARE_LOCATION_ID','SQUARE_TERMINAL_DEVICE_ID','RESEND_API_KEY','SENDGRID_API_KEY','EMAIL_FROM','TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_FROM','TWILIO_MESSAGING_SERVICE_SID','TWILIO_DISPLAY_NUMBER','HEALTH_TOKEN','NODE_VERSION']
defaults={'DATA_DIR':'/var/data','TRUST_PROXY':'1','SQUARE_ENVIRONMENT':'sandbox','NODE_VERSION':'22.14.0'}
out=[{'key':k,'value':os.environ.get(k,defaults.get(k,''))} for k in keys if os.environ.get(k) or k in defaults]
print(json.dumps(out))
EOF
}
EXISTING=$(curl -sS "${H[@]}" "$API/services?name=$NAME&limit=5" | NAME="$NAME" python3 -c 'import json,os,sys; d=json.load(sys.stdin); print(next((s["service"]["id"] for s in d if s["service"]["name"]==os.environ["NAME"]), ""))')
if [ -z "$EXISTING" ]; then
  BODY=$(python3 - "$OWNER" "$REPO" "$NAME" "$REGION" "$PLAN" "$(env_json)" <<'EOF'
import json,sys
owner,repo,name,region,plan,envs=sys.argv[1:7]
print(json.dumps({"type":"web_service","name":name,"ownerId":owner,"repo":repo,"branch":"main","autoDeploy":"yes","rootDir":"",
  "envVars":json.loads(envs),
  "serviceDetails":{"runtime":"node","plan":plan,"region":region,"numInstances":1,"healthCheckPath":"/health",
    "envSpecificDetails":{"buildCommand":"echo no build step needed","startCommand":"npm start"},
    "disk":{"name":"parkops-data","mountPath":"/var/data","sizeGB":1}}}))
EOF
)
  RESP=$(curl -sS "${H[@]}" -X POST "$API/services" -d "$BODY")
  SID=$(printf '%s' "$RESP" | json_get 'd.get("service",{}).get("id","")') || SID=""
  [ -n "$SID" ] || { echo "Render refused to create the service: $RESP" >&2; echo "If it says the repository is not accessible, install the Render GitHub app on it first (Render dashboard → Account → GitHub)." >&2; exit 1; }
  URL=$(printf '%s' "$RESP" | json_get 'd["service"]["serviceDetails"].get("url","")')
  echo "Created service $SID → $URL"
else
  SID="$EXISTING"
  URL=$(curl -sS "${H[@]}" "$API/services/$SID" | json_get 'd["serviceDetails"].get("url","")')
  echo "Updating env vars on existing service $SID → $URL"
  curl -sS "${H[@]}" -X PUT "$API/services/$SID/env-vars" -d "$(env_json)" >/dev/null
  curl -sS "${H[@]}" -X POST "$API/services/$SID/deploys" -d '{"clearCache":"do_not_clear"}' >/dev/null
fi
# Point every emailed/texted/QR link at the service's own address unless a custom PUBLIC_URL was given.
if [ -z "${PUBLIC_URL:-}" ] && [ -n "$URL" ]; then
  curl -sS "${H[@]}" -X PUT "$API/services/$SID/env-vars/PUBLIC_URL" -d "{\"value\":\"$URL\"}" >/dev/null && echo "PUBLIC_URL set to $URL"
fi
echo "Waiting for the deploy to go live (this takes 2–4 minutes)…"
for i in $(seq 1 60); do
  sleep 10
  ST=$(curl -sS "${H[@]}" "$API/services/$SID/deploys?limit=1" | json_get 'd[0]["deploy"]["status"]' 2>/dev/null || echo "?")
  printf '  %s\n' "$ST"
  case "$ST" in live) break;; build_failed|update_failed|canceled|deactivated) echo "Deploy failed ($ST). Open the service logs in the Render dashboard." >&2; exit 1;; esac
done
if [ -n "$URL" ]; then
  echo; echo "Health: $(curl -sS "$URL/health")"
  echo "Staff sign in: $URL/login  (as $ADMIN_EMAIL)"; echo "Driver portal: $URL/"
fi
