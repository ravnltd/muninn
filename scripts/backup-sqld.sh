#!/bin/bash
# Daily backup of sqld database
# Run via cron: 0 3 * * * /opt/muninn/scripts/backup-sqld.sh

set -e

BACKUP_DIR="${HOME}/.claude/backups"
DATE=$(date +%Y%m%d)
KEEP_DAYS=7

mkdir -p "$BACKUP_DIR"

# Copy database from container
docker cp muninn-sqld:/var/lib/sqld/iku.db/dbs/default/data "$BACKUP_DIR/sqld-${DATE}.db"

# Verify backup
if sqlite3 "$BACKUP_DIR/sqld-${DATE}.db" "PRAGMA integrity_check;" | grep -q "ok"; then
    echo "✓ Backup verified: sqld-${DATE}.db ($(du -h "$BACKUP_DIR/sqld-${DATE}.db" | cut -f1))"
else
    echo "✗ Backup verification failed!"
    exit 1
fi

# Clean old backups
find "$BACKUP_DIR" -name "sqld-*.db" -mtime +${KEEP_DAYS} -delete

echo "✓ Backup complete. Keeping last ${KEEP_DAYS} days."
ls -lh "$BACKUP_DIR"/sqld-*.db 2>/dev/null | tail -5
