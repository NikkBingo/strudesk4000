#!/bin/sh

# Resolve any failed migrations first
if [ -n "$DATABASE_URL" ]; then
  echo "Checking database state..."
  
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
    npx prisma migrate deploy
  fi
  
  echo "Generating Prisma client..."
  npx prisma generate
fi

echo "Starting server..."
exec npm start

