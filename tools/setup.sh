#!/usr/bin/env bash
# StudentHUB – jednorazové nastavenie v Google Cloud Shell:
#   1. CORS na bucket (sťahovanie prác z GitHub Pages)
#   2. nasadenie Cloud Function, ktorá meria spotrebu Firebase
# Spustenie v Cloud Shell:  curl -sLo s.sh https://raw.githubusercontent.com/jzac369/studenthub/main/tools/setup.sh && bash s.sh
set -euo pipefail

PROJECT=studenthub-bc04b
BUCKET=gs://studenthub-bc04b.firebasestorage.app

echo "== Projekt $PROJECT"
gcloud config set project "$PROJECT" --quiet

echo "== Sťahujem StudentHUB z GitHubu"
cd ~
rm -rf ~/studenthub
git clone -q https://github.com/jzac369/studenthub.git ~/studenthub
cd ~/studenthub

echo "== CORS pre $BUCKET"
gcloud storage buckets update "$BUCKET" --cors-file=firebase/cors.json
gcloud storage buckets describe "$BUCKET" --format='value(cors_config)'

echo "== Zapínam potrebné služby Google Cloud"
gcloud services enable monitoring.googleapis.com cloudfunctions.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com run.googleapis.com eventarc.googleapis.com cloudscheduler.googleapis.com \
  pubsub.googleapis.com --quiet

echo "== Inštalujem závislosti funkcie"
(cd functions && npm ci --no-audit --no-fund --loglevel=error)

echo "== Nasadzujem Cloud Function"
FIREBASE="firebase"
command -v firebase >/dev/null || FIREBASE="npx -y firebase-tools@latest"
$FIREBASE deploy --only functions --project "$PROJECT" --force --non-interactive

echo "== Hotovo"
