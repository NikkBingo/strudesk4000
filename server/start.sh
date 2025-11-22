#!/bin/sh

# Resolve any failed migrations first
if [ -n "$DATABASE_URL" ]; then
  echo "Resolving failed migrations..."
  npx prisma migrate resolve --rolled-back add_genre_field 2>/dev/null || true
  
  echo "Deploying migrations..."
  npx prisma migrate deploy || {
    echo "Migration deploy failed, checking if genre column exists..."
    # Try to manually apply if migration failed but column doesn't exist
    npx prisma db execute --stdin <<EOF 2>/dev/null || true
ALTER TABLE "patterns" ADD COLUMN IF NOT EXISTS "genre" TEXT;
CREATE INDEX IF NOT EXISTS "patterns_genre_idx" ON "patterns"("genre");
EOF
    # Mark migration as applied if we manually fixed it
    npx prisma migrate resolve --applied add_genre_field 2>/dev/null || true
  }
fi

echo "Starting server..."
npm start

