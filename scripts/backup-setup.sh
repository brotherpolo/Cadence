#!/usr/bin/env bash
# One-time setup for the nightly backup (functions/index.js → nightlyBackup). Run it in Cloud
# Shell after the functions are deployed:   bash scripts/backup-setup.sh
# It looks up the account the backup runs as, and lets that account (only) export the database
# and write to the backup bucket. It never changes firebase-adminsdk-fbsvc.
set -euo pipefail
PROJECT=tasks-2ae9d
BUCKET=${BACKUP_BUCKET:-tasks-2ae9d-db-exports}
REGION=${CADENCE_REGION:-us-central1}
SA=$(gcloud functions describe nightlyBackup --region="$REGION" --project="$PROJECT" --format='value(serviceConfig.serviceAccountEmail)' 2>/dev/null || true)
if [ -z "$SA" ]; then
  echo "nightlyBackup isn't deployed yet. Run  bash deploy.sh firestore:rules,functions  first, then this again." >&2
  exit 1
fi
case "$SA" in
  firebase-adminsdk-*) echo "The backup runs as $SA, which this script leaves alone. Nothing was changed." >&2; exit 1 ;;
esac
echo "The nightly backup runs as: $SA"
echo "1/2  Letting it export the database …"
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" --role="roles/datastore.importExportAdmin" --condition=None --quiet >/dev/null
echo "2/2  Letting it write to (and tidy nightly/ in) gs://$BUCKET …"
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$SA" --role="roles/storage.objectAdmin" --quiet >/dev/null
echo
echo "Done. The first backup runs tonight at 2:30 a.m. To run one now:"
echo "  gcloud scheduler jobs run firebase-schedule-nightlyBackup-$REGION --location=$REGION --project=$PROJECT"
echo "Then look in Formwright → Settings → Problems and backups (it takes a minute or two)."
