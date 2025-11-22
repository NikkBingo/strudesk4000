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
    echo "⚠️  Database tables don't exist. Applying migrations..."
    
    # Reset any failed migration state
    npx prisma migrate resolve --rolled-back add_genre_field 2>/dev/null || true
    
    # Try to deploy migrations
    npx prisma migrate deploy || {
      echo "⚠️  Migration deploy failed. This might be normal if migration state is inconsistent."
      echo "If tables still don't exist after this, you may need to run migrations manually."
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

