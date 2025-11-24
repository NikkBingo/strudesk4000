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
  MIGRATION_OUTPUT=$(npx prisma migrate deploy 2>&1)
  MIGRATION_EXIT_CODE=$?
  
  if [ $MIGRATION_EXIT_CODE -ne 0 ]; then
    echo "$MIGRATION_OUTPUT" >&2
    
    # Check if the error is about columns already existing
    if echo "$MIGRATION_OUTPUT" | grep -qi "already exists"; then
      echo "⚠️ Migration failed due to existing columns. Attempting to resolve..." >&2
      
      # Extract migration name from error (format: "Migration name: 20241124_add_email_auth_fields")
      MIGRATION_NAME=$(echo "$MIGRATION_OUTPUT" | grep -i "Migration name:" | sed -E 's/.*[Mm]igration [Nn]ame: *([^ ]+).*/\1/' | head -1)
      
      # Fallback: try extracting from directory pattern
      if [ -z "$MIGRATION_NAME" ]; then
        MIGRATION_NAME=$(echo "$MIGRATION_OUTPUT" | grep -oE '[0-9]{8}_[a-zA-Z_]+' | head -1)
      fi
      
      if [ -n "$MIGRATION_NAME" ]; then
        echo "✅ Resolving migration: $MIGRATION_NAME" >&2
        RESOLVE_OUTPUT=$(npx prisma migrate resolve --applied "$MIGRATION_NAME" 2>&1)
        RESOLVE_EXIT=$?
        echo "$RESOLVE_OUTPUT" >&2
        
        if [ $RESOLVE_EXIT -eq 0 ]; then
          echo "✅ Migration resolved. Retrying migrations..." >&2
          # Retry migrations after resolving
          npx prisma migrate deploy >&2
        else
          echo "❌ Failed to resolve migration. Continuing anyway..." >&2
        fi
      else
        echo "❌ Could not extract migration name from error. Continuing..." >&2
      fi
    else
      echo "⚠️ Migration failed with unknown error. Continuing..." >&2
    fi
  else
    echo "$MIGRATION_OUTPUT" >&2
  fi
  
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
