#!/usr/bin/env bash
# Deploy from Cloud Shell, backing up the database first. If the backup fails, nothing is deployed.
#   ./deploy.sh firestore:rules,firestore:indexes,functions
# The backup goes to gs://tasks-2ae9d-db-exports/before-deploy/ and is kept 90 days.
set -euo pipefail
PROJECT=tasks-2ae9d
BUCKET=${BACKUP_BUCKET:-tasks-2ae9d-db-exports}
ONLY="${1:-}"
if [ -z "$ONLY" ]; then
  echo "Say what to deploy, for example:  ./deploy.sh firestore:rules,firestore:indexes,functions" >&2
  exit 1
fi
FOLDER="gs://$BUCKET/before-deploy/$(date -u +%Y%m%d-%H%M)-cloudshell"
echo "1/2  Backing up the database to $FOLDER …"
if ! gcloud firestore export "$FOLDER" --project="$PROJECT"; then
  echo "The backup failed, so nothing was deployed. Fix the problem above and try again." >&2
  exit 1
fi
echo "2/2  Backup done. Deploying $ONLY …"
firebase deploy --only "$ONLY" --project "$PROJECT"
