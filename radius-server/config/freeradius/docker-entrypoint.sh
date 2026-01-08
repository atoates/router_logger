#!/bin/sh
set -e

# Substitute environment variables in SQL config template
if [ -f /etc/freeradius/mods-available/sql.template ]; then
    echo "Configuring SQL module with environment variables..."
    sed -e "s/\${RADIUS_DB_HOST}/${RADIUS_DB_HOST:-radius-db}/g" \
        -e "s/\${RADIUS_DB_PORT}/${RADIUS_DB_PORT:-3306}/g" \
        -e "s/\${RADIUS_DB_USER}/${RADIUS_DB_USER:-radius}/g" \
        -e "s/\${RADIUS_DB_PASSWORD}/${RADIUS_DB_PASSWORD:-radiuspass123}/g" \
        -e "s/\${RADIUS_DB_NAME}/${RADIUS_DB_NAME:-radius}/g" \
        /etc/freeradius/mods-available/sql.template > /etc/freeradius/mods-enabled/sql
    echo "SQL module configured successfully"
fi

# Enable REST module
if [ -f /etc/freeradius/mods-available/rest ]; then
    echo "Enabling REST module..."
    ln -sf ../mods-available/rest /etc/freeradius/mods-enabled/rest
    echo "REST module enabled"
fi

# Execute the main command (freeradius)
exec "$@"

