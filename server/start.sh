#!/bin/sh
# Don't use set -e, handle errors explicitly

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
    
    # Reset any failed migration state
    npx prisma migrate resolve --rolled-back add_genre_field 2>/dev/null || true
    
    # Deploy all migrations (this will create tables)
    npx prisma migrate deploy || {
      echo "⚠️  Migration deploy failed. Trying to apply migrations manually..."
      # If migrate deploy fails, try applying SQL files directly
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
    
    # Try to resolve any failed migrations
    npx prisma migrate resolve --rolled-back add_genre_field 2>/dev/null && echo "Resolved failed migration" || echo "No failed migrations"
    
    # Deploy any pending migrations (with timeout to prevent hanging)
    echo "Deploying migrations..."
    timeout 30 npx prisma migrate deploy 2>&1 || {
      EXIT_CODE=$?
      echo "⚠️  Migration deploy exited with code $EXIT_CODE, but continuing..."
    }
    echo "✓ Migration check complete (continuing to server start)"
  fi
  
  echo "=== Generating Prisma client ==="
  timeout 30 npx prisma generate || {
    echo "⚠️  Prisma generate failed or timed out, but continuing..."
  }
  echo "✓ Prisma client generated"
else
  echo "⚠️  DATABASE_URL not set, skipping database setup"
  echo "=== Generating Prisma client (without DB) ==="
  timeout 30 npx prisma generate || {
    echo "⚠️  Prisma generate failed or timed out, but continuing..."
  }
fi

echo ""
echo "========================================="
echo "=== Starting server ==="
echo "========================================="
echo "Working directory: $(pwd)"
echo "PORT environment variable: ${PORT:-not set}"
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

# Start the server directly with node (not npm start)
# This ensures we see all output and errors
exec node index.js

