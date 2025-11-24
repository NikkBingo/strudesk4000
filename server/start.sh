#!/bin/sh

# Immediately write to stderr (Railway shows this)
echo "=== START SCRIPT BEGIN ===" >&2
echo "PID: $$" >&2
echo "Date: $(date)" >&2
echo "PWD: $(pwd)" >&2
echo "PORT: ${PORT:-NOT_SET}" >&2

# Test if node works
echo "Testing node..." >&2
node --version >&2 || {
  echo "ERROR: node not found!" >&2
  exit 1
}

# Always regenerate Prisma client to ensure schema changes are picked up
echo "Generating Prisma client..." >&2
npx prisma generate >&2 || {
  echo "ERROR: Prisma generate failed" >&2
  exit 1
}

# Run migrations (this is what we see in logs)
if [ -n "$DATABASE_URL" ]; then
  echo "Running migrations..." >&2
  npx prisma migrate deploy --skip-seed >&2 || echo "Migration warning (continuing)..." >&2
  echo "Migrations done" >&2
fi

# Check if index.js exists
if [ ! -f "index.js" ]; then
  echo "ERROR: index.js not found!" >&2
  ls -la >&2
  exit 1
fi

echo "Starting server with: node index.js" >&2
echo "PORT will be: ${PORT:-3001}" >&2
echo "=== ABOUT TO START NODE ===" >&2

# Start server - use exec to replace shell process
exec node index.js
