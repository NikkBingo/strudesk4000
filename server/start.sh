#!/bin/sh

# Resolve any failed migrations first
if [ -n "$DATABASE_URL" ]; then
  echo "Checking for failed migrations..."
  
  # Try to resolve the failed migration by marking it as rolled back
  npx prisma migrate resolve --rolled-back add_genre_field 2>/dev/null && echo "Marked failed migration as rolled back" || echo "No failed migration to resolve or already resolved"
  
  echo "Deploying migrations..."
  npx prisma migrate deploy
  
  # If migrate deploy says no pending migrations but tables don't exist, force apply
  if [ $? -ne 0 ]; then
    echo "Migration deploy had issues. Checking database state..."
    # Try to apply migrations from scratch if needed
    npx prisma migrate deploy --skip-seed || {
      echo "Attempting to resolve migration state..."
      npx prisma migrate resolve --applied add_genre_field 2>/dev/null || true
    }
  fi
  
  echo "Generating Prisma client..."
  npx prisma generate
fi

echo "Starting server..."
exec npm start

