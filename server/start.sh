#!/bin/sh

# Write all output to stderr so Railway shows it
exec >&2

echo "=== START SCRIPT RUNNING ===" >&2
echo "Script started at: $(date)" >&2
echo "Current directory: $(pwd)" >&2
echo "Node version: $(node --version)" >&2
echo "PORT: ${PORT:-not set}" >&2

# Skip migrations if they're already applied - just start the server
if [ -n "$DATABASE_URL" ]; then
  echo "=== Quick migration check ===" >&2
  # Just check if migrations are needed, don't wait
  npx prisma migrate deploy --skip-seed 2>&1 | head -20 || echo "Migration check done" >&2
  echo "=== Migration check complete, starting server ===" >&2
fi

echo "" >&2
echo "=========================================" >&2
echo "=== STARTING SERVER NOW ===" >&2
echo "=========================================" >&2
echo "Working directory: $(pwd)" >&2
echo "PORT: ${PORT:-not set}" >&2
echo "" >&2

# Verify index.js exists
if [ ! -f "index.js" ]; then
  echo "❌ ERROR: index.js not found in $(pwd)" >&2
  echo "Files in directory:" >&2
  ls -la >&2
  exit 1
fi

echo "✅ index.js found" >&2
echo "🚀 EXECUTING: node index.js" >&2
echo "If you don't see server logs after this, node is crashing" >&2
echo "" >&2

# Start the server - redirect both stdout and stderr
exec node index.js >&2
