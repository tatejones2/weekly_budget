# Restoring the weekly_budget database

Backups are stored in `~/backups/weekly` in PostgreSQL custom format.

To inspect a backup:

```bash
docker exec -i postgres pg_restore --list < ~/backups/weekly/weekly-TIMESTAMP.dump
```

To restore into an empty `weekly` database:

```bash
docker exec -i postgres pg_restore -U dbadmin -d weekly --clean --if-exists --no-owner --no-acl < ~/backups/weekly/weekly-TIMESTAMP.dump
```

Stop the `weekly-budget` container before a full restore and restart it afterward. Test the restore procedure periodically. Droplet-level backups or off-server copies are still recommended because local backups do not protect against complete Droplet loss.
