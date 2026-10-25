#!/usr/bin/env bash
# Nasadí pravidlá Firestore a Storage cez Firebase Rules API (v Google Cloud Shell, bez firebase login).
# Použitie: bash tools/deploy-rules.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT=studenthub-bc04b
BUCKET=studenthub-bc04b.firebasestorage.app
API=https://firebaserules.googleapis.com/v1/projects/$PROJECT
TOKEN=$(gcloud auth print-access-token)

deploy() { # $1 = súbor s pravidlami, $2 = názov release
  local body ruleset
  body=$(python3 -c 'import json,sys; print(json.dumps({"source": {"files": [{"name": sys.argv[1].split("/")[-1], "content": open(sys.argv[1]).read()}]}}))' "$1")
  ruleset=$(curl -sf -X POST "$API/rulesets" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$body" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])')
  curl -sf -X PATCH "$API/releases/$2" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"release\": {\"name\": \"projects/$PROJECT/releases/$2\", \"rulesetName\": \"$ruleset\"}}" > /dev/null
  echo "OK  $1 -> $ruleset"
}

deploy firebase/firestore.rules cloud.firestore
deploy firebase/storage.rules "firebase.storage/$BUCKET"
echo "Pravidlá nasadené."
