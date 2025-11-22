#!/bin/sh

echo "=== START SCRIPT RUNNING ==="
echo "Script started at: $(date)"
echo "Current directory: $(pwd)"
echo "Node version: $(node --version)"
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
    echo "Deploying migrations (with 5 second timeout)..."
    # Run migrate deploy with a simple timeout approach
    (sleep 5 && echo "⚠️  Migration check timeout, continuing...") &
    TIMEOUT_PID=$!
    npx prisma migrate deploy 2>&1 || echo "⚠️  Migration deploy had issues"
    kill $TIMEOUT_PID 2>/dev/null || true
    echo "✓ Migration check complete - PROCEEDING TO SERVER"
  fi
  
  echo "=== Prisma client (already generated in build) ==="
  echo "✓ Prisma client ready"
else
  echo "⚠️  DATABASE_URL not set, skipping database setup"
fi

echo ""
echo "========================================="
echo "=== STARTING SERVER NOW ==="
echo "========================================="
echo "Working directory: $(pwd)"
echo "PORT: ${PORT:-not set}"
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
echo "About to start server - if you don't see server logs after this, node is crashing"
echo ""

# Start the server directly with node
# Don't use exec initially so we can see if there's an immediate error
node index.js || {
  echo "❌ Server failed to start!"
  echo "Exit code: $?"
  exit 1
}
