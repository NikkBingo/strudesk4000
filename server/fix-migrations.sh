#!/bin/sh

# Script to fix migration state when tables don't exist
# This can be run manually via Railway shell if needed

if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL not set"
  exit 1
fi

echo "Checking if users table exists..."
TABLE_EXISTS=$(npx prisma db execute --stdin <<EOF 2>/dev/null | grep -q "users" && echo "yes" || echo "no"
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users';
EOF
)

if [ "$TABLE_EXISTS" = "no" ]; then
  echo "Tables don't exist. Applying migrations from scratch..."
  
  # Reset migration state
  npx prisma migrate resolve --rolled-back add_genre_field 2>/dev/null || true
  
  # Try to apply all migrations
  npx prisma migrate deploy
  
  # If that fails, manually apply the SQL
  if [ $? -ne 0 ]; then
    echo "Migration deploy failed. Applying SQL manually..."
    npx prisma db execute --file prisma/migrations/add_genre_field/migration.sql || {
      echo "Manual SQL application failed. Trying direct SQL..."
      npx prisma db execute --stdin <<SQL
-- Create users table if it doesn't exist
CREATE TABLE IF NOT EXISTS "users" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "oauth_provider" TEXT NOT NULL,
  "oauth_id" TEXT NOT NULL,
  "avatar_url" TEXT,
  "artist_name" TEXT,
  "social_links" JSONB DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "users_oauth_provider_oauth_id_key" ON "users"("oauth_provider", "oauth_id");

-- Create patterns table
CREATE TABLE IF NOT EXISTS "patterns" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "element_id" TEXT,
  "pattern_code" TEXT NOT NULL,
  "title" TEXT,
  "artist_name" TEXT,
  "genre" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "version_name" TEXT,
  "is_public" BOOLEAN NOT NULL DEFAULT false,
  "user_count" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "patterns_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "patterns_user_id_idx" ON "patterns"("user_id");
CREATE INDEX IF NOT EXISTS "patterns_is_public_idx" ON "patterns"("is_public");
CREATE INDEX IF NOT EXISTS "patterns_type_idx" ON "patterns"("type");
CREATE INDEX IF NOT EXISTS "patterns_genre_idx" ON "patterns"("genre");

ALTER TABLE "patterns" ADD CONSTRAINT "patterns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create pattern_shares table
CREATE TABLE IF NOT EXISTS "pattern_shares" (
  "id" TEXT NOT NULL,
  "pattern_id" TEXT NOT NULL,
  "shared_with_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pattern_shares_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "pattern_shares_pattern_id_shared_with_user_id_key" ON "pattern_shares"("pattern_id", "shared_with_user_id");
CREATE INDEX IF NOT EXISTS "pattern_shares_shared_with_user_id_idx" ON "pattern_shares"("shared_with_user_id");

ALTER TABLE "pattern_shares" ADD CONSTRAINT "pattern_shares_pattern_id_fkey" FOREIGN KEY ("pattern_id") REFERENCES "patterns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pattern_shares" ADD CONSTRAINT "pattern_shares_shared_with_user_id_fkey" FOREIGN KEY ("shared_with_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Mark migration as applied
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) 
VALUES ('add_genre_field', '', NOW(), 'add_genre_field', NULL, NULL, NOW(), 1)
ON CONFLICT DO NOTHING;
SQL
    }
    
    # Mark migration as applied
    npx prisma migrate resolve --applied add_genre_field 2>/dev/null || true
  fi
else
  echo "Tables exist. Migration state is correct."
fi

echo "Generating Prisma client..."
npx prisma generate

echo "Done!"

