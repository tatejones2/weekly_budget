#!/usr/bin/env sh
set -eu

# Run once, manually, via SSH on the droplet (needs the Postgres admin
# credential) — mirrors digital_cookbook/deployment/bootstrap-droplet.sh
# exactly, with its own database/role/env file so nothing here ever touches
# mise's data.

APP_DIR="${HOME}/weekly_budget"
BACKUP_DIR="${HOME}/backups/weekly"
DB_CONTAINER="postgres"
DB_ADMIN="dbadmin"
DB_NAME="weekly"
DB_USER="weekly_app"

umask 077
mkdir -p "$APP_DIR" "$BACKUP_DIR"

DB_PASSWORD="$(openssl rand -hex 32)"
docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DB_ADMIN" -d production -v role_password="$DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE weekly_app LOGIN PASSWORD %L', :'role_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'weekly_app') \gexec
ALTER ROLE weekly_app WITH PASSWORD :'role_password';
SELECT 'CREATE DATABASE weekly OWNER weekly_app'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'weekly') \gexec
REVOKE ALL ON DATABASE weekly FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE weekly TO weekly_app;
SQL

cat > "$APP_DIR/.env.production" <<ENVEOF
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@postgres:5432/${DB_NAME}
DATABASE_SSL=false
DATABASE_POOL_SIZE=5
FRONTEND_URL=https://weekly.tatercooks.com
PORT=3002
NODE_ENV=production
ENVEOF
chmod 600 "$APP_DIR/.env.production"
echo "Created isolated database, role, and production environment file."
