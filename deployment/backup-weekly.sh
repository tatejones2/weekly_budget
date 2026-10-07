#!/usr/bin/env sh
set -eu

# Daily cron entry (crontab -e):
#   17 3 * * * /home/tatejones/weekly_budget/deployment/backup-weekly.sh >> /home/tatejones/logs/weekly-backup.log 2>&1
# Mirrors digital_cookbook/deployment/backup-mise.sh — own container/database,
# own backup directory, own retention. Never touches mise's backups.

BACKUP_DIR="${HOME}/backups/weekly"
DB_CONTAINER="postgres"
DB_ADMIN="dbadmin"
DB_NAME="weekly"
KEEP_DAYS=14

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$BACKUP_DIR/weekly-$STAMP.dump"

docker exec "$DB_CONTAINER" pg_dump -U "$DB_ADMIN" -d "$DB_NAME" --format=custom > "$FILE"
echo "Backed up $DB_NAME to $FILE"

find "$BACKUP_DIR" -name 'weekly-*.dump' -mtime "+$KEEP_DAYS" -delete
