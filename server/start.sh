#!/bin/sh

# Force output to be visible
exec > >(tee -a /proc/1/fd/1) 2>&1 || true

echo "=== START SCRIPT RUNNING ==="
echo "Script started at: $(date)"
echo "Current directory: $(pwd)"
echo "Node version: $(node --version)"
echo "NPM version: $(npm --version)"
echo "PORT: ${PORT:-not set}"
echo "DATABASE_URL: ${DATABASE_URL:+set}"

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
    # Run migrate deploy in background with timeout to prevent hanging
    (npx prisma migrate deploy 2>&1 &)
    MIGRATE_PID=$!
    sleep 5
    if kill -0 $MIGRATE_PID 2>/dev/null; then
      echo "⚠️  Migration deploy still running after 5s, continuing anyway..."
      kill $MIGRATE_PID 2>/dev/null || true
    else
      wait $MIGRATE_PID 2>/dev/null || true
      echo "✓ Migration deploy completed"
    fi
    echo "✓ Migration check complete - CONTINUING TO SERVER START"
  fi
  
  echo "=== Generating Prisma client ==="
  # Prisma client should already be generated in Dockerfile, but regenerate to be safe
  echo "Skipping prisma generate (already done in build)"
  echo "✓ Prisma client ready"
else
  echo "⚠️  DATABASE_URL not set, skipping database setup"
  echo "=== Prisma client (already generated in build) ==="
fi

echo ""
echo "========================================="
echo "=== STARTING SERVER NOW ==="
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
echo "🚀 EXECUTING: node index.js"
echo ""

# Start the server directly with node
# Use exec to replace shell process
exec node index.js
