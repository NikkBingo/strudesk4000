#!/bin/sh

# Script to resolve failed migrations when columns already exist
# Usage: ./resolve-migration.sh <migration_name>

MIGRATION_NAME=$1

if [ -z "$MIGRATION_NAME" ]; then
  echo "Usage: ./resolve-migration.sh <migration_name>" >&2
  exit 1
fi

echo "Attempting to resolve migration: $MIGRATION_NAME" >&2

# Try to mark the migration as applied
npx prisma migrate resolve --applied "$MIGRATION_NAME" >&2

if [ $? -eq 0 ]; then
  echo "Migration $MIGRATION_NAME marked as applied successfully" >&2
  exit 0
else
  echo "Failed to resolve migration $MIGRATION_NAME" >&2
  exit 1
fi

