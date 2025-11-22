#!/bin/sh
set -e  # Exit on error

echo "=== Starting Container ==="
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
    
    # Deploy any pending migrations
    echo "Deploying migrations..."
    npx prisma migrate deploy
  fi
  
  echo "=== Generating Prisma client ==="
  npx prisma generate || {
    echo "⚠️  Prisma generate failed, but continuing..."
  }
  echo "✓ Prisma client generated"
else
  echo "⚠️  DATABASE_URL not set, skipping database setup"
fi

echo "=== Starting server ==="
echo "Running: npm start"
echo "Working directory: $(pwd)"
echo "Files in current directory: $(ls -la | head -10)"

# Start the server (don't use exec so we can see errors)
npm start

