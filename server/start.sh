#!/bin/sh

# Resolve any failed migrations first
if [ -n "$DATABASE_URL" ]; then
  echo "Checking for failed migrations..."
  
  # Try to resolve the failed migration by marking it as rolled back
  npx prisma migrate resolve --rolled-back add_genre_field 2>/dev/null && echo "Marked failed migration as rolled back" || echo "No failed migration to resolve or already resolved"
  
  echo "Deploying migrations..."
  npx prisma migrate deploy || {
    echo "Migration deploy failed. Attempting to resolve..."
    # If deploy fails, try to mark as applied (in case it partially succeeded)
    npx prisma migrate resolve --applied add_genre_field 2>/dev/null || true
    echo "Continuing with server start..."
  }
fi

echo "Starting server..."
exec npm start

