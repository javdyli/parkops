#!/usr/bin/env bash
# Put this folder on GitHub as a private repository and push it.
# Needs: git, curl, and a GitHub token with permission to create repositories and push
#   (Settings → Developer settings → Personal access tokens; classic token with the "repo" scope,
#    or a fine-grained token with "Administration: write" and "Contents: write" on all repositories).
# Usage: GITHUB_TOKEN=ghp_xxx bash scripts/github-push.sh [repo-name]      (default name: parkops)
# In a Claude session with the GitHub connector linked, no token is needed: leave GITHUB_TOKEN unset.
set -euo pipefail
NAME="${1:-parkops}"
cd "$(dirname "$0")/.."
API="https://api.github.com"
H=(-H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")
[ -n "${GITHUB_TOKEN:-}" ] && H+=(-H "Authorization: Bearer $GITHUB_TOKEN")
USER_JSON=$(curl -sS "${H[@]}" "$API/user")
LOGIN=$(printf '%s' "$USER_JSON" | sed -n 's/.*"login": *"\([^"]*\)".*/\1/p' | head -1)
[ -n "$LOGIN" ] || { echo "The token was refused by GitHub: $USER_JSON" >&2; exit 1; }
echo "Signed in to GitHub as $LOGIN"
# Create the private repository if it does not exist yet.
if curl -sS -o /dev/null -w '%{http_code}' "${H[@]}" "$API/repos/$LOGIN/$NAME" | grep -q '^404$'; then
  curl -sS "${H[@]}" -X POST "$API/user/repos" -d "{\"name\":\"$NAME\",\"private\":true,\"description\":\"ParkOps parking operations\"}" >/dev/null
  echo "Created private repository $LOGIN/$NAME"
else
  echo "Repository $LOGIN/$NAME already exists; pushing to it"
fi
git init -q 2>/dev/null || true
git add -A
git -c user.name="${GIT_AUTHOR_NAME:-ParkOps}" -c user.email="${GIT_AUTHOR_EMAIL:-parkops@users.noreply.github.com}" commit -qm "${COMMIT_MSG:-ParkOps $(date +%Y-%m-%d)}" || echo "Nothing new to commit"
git branch -M main
# The token (if any) is used only for this push and is not written to .git/config.
if [ -n "${GITHUB_TOKEN:-}" ]; then PUSH_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/$LOGIN/$NAME.git"; else PUSH_URL="https://github.com/$LOGIN/$NAME.git"; fi
git push -q "$PUSH_URL" main --force-with-lease 2>/dev/null || git push -q "$PUSH_URL" main
git remote remove origin 2>/dev/null || true
git remote add origin "https://github.com/$LOGIN/$NAME.git"
echo
echo "Pushed. Repository: https://github.com/$LOGIN/$NAME"
echo "Deploy it on Render with one click: https://render.com/deploy?repo=https://github.com/$LOGIN/$NAME"
