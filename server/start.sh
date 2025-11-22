#!/bin/sh

echo "=== Starting Container ==="
echo "Script started at: $(date)"
echo "Current directory: $(pwd)"
echo "Node version: $(node --version)"
echo "NPM version: $(npm --version)"
echo "PORT: ${PORT:-not set}"

# Resolve any failed migrations first
if [ -n "$DATABASE_URL" ]; then
  echo "=== Checking database state ==="
  
  # Check if users table exists
  TABLE_CHECK=$(npx prisma db execute --stdin <<'EOF' 2>/dev/null | grep -c "users" || echo "0"
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users';
EOF
)
  
  if [ "$TABLE_CHECK" = "0" ]; then
    echo "⚠️  Database tables don't exist. Applying all migrations from scratch..."
    npx prisma migrate resolve --rolled-back add_genre_field 2>/dev/null || true
    npx prisma migrate deploy || {
      echo "⚠️  Migration deploy failed. Trying to apply migrations manually..."
      if [ -f "prisma/migrations/0_init/migration.sql" ]; then
        echo "Applying initial migration..."
        npx prisma db execute --file prisma/migrations/0_init/migration.sql --schema prisma/schema.prisma || true
      fi
      if [ -f "prisma/migrations/add_genre_field/migration.sql" ]; then
        echo "Applying genre field migration..."
        npx prisma db execute --file prisma/migrations/add_genre_field/migration.sql --schema prisma/schema.prisma || true
      fi
    }
  else
    echo "✓ Database tables exist. Checking migration state..."
    npx prisma migrate resolve --rolled-back add_genre_field 2>/dev/null && echo "Resolved failed migration" || echo "No failed migrations"
    echo "Deploying migrations..."
    npx prisma migrate deploy 2>&1 || echo "⚠️  Migration deploy had issues, but continuing..."
    echo "✓ Migration check complete"
  fi
  
  echo "=== Generating Prisma client ==="
  npx prisma generate 2>&1 || echo "⚠️  Prisma generate had issues, but continuing..."
  echo "✓ Prisma client ready"
else
  echo "⚠️  DATABASE_URL not set, skipping database setup"
  echo "=== Generating Prisma client (without DB) ==="
  npx prisma generate 2>&1 || echo "⚠️  Prisma generate had issues, but continuing..."
fi

echo ""
echo "========================================="
echo "=== Starting server ==="
echo "========================================="
echo "Working directory: $(pwd)"
echo "PORT: ${PORT:-not set}"
echo "NODE_ENV: ${NODE_ENV:-not set}"
echo ""

# Verify index.js exists
if [ ! -f "index.js" ]; then
  echo "❌ ERROR: index.js not found in $(pwd)"
  echo "Files in directory:"
  ls -la
  exit 1
fi

echo "✅ index.js found"
echo "🚀 Starting Node.js server..."
echo ""

# Start the server directly with node
exec node index.js
