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
  
  # Wait a bit for database to be ready (Railway may need a moment)
  echo "Waiting 3 seconds for database to be ready..." >&2
  sleep 3
  
  # Test database connection first
  echo "Testing database connection..." >&2
  CONNECTION_TEST=$(npx prisma db execute --stdin <<'EOF' 2>&1 || echo "CONNECTION_FAILED"
SELECT 1 as test;
EOF
  )
  
  if echo "$CONNECTION_TEST" | grep -qi "CONNECTION_FAILED\|Can't reach\|P1001"; then
    echo "⚠️ Database connection test failed. Waiting 5 more seconds..." >&2
    sleep 5
  else
    echo "✅ Database connection test successful" >&2
  fi
  
  # Try to deploy migrations
  MIGRATION_OUTPUT=$(npx prisma migrate deploy 2>&1)
  MIGRATION_EXIT_CODE=$?
  
  if [ $MIGRATION_EXIT_CODE -ne 0 ]; then
    echo "$MIGRATION_OUTPUT" >&2
    
    # Check if error is about failed migrations preventing new ones
    if echo "$MIGRATION_OUTPUT" | grep -qi "failed migrations in the target database\|found failed migrations"; then
      echo "⚠️ Failed migrations detected. Attempting to resolve..." >&2
      
      # Extract failed migration name - try multiple patterns
      FAILED_MIGRATION=$(echo "$MIGRATION_OUTPUT" | grep -i "migration.*started at\|The.*migration.*failed" | sed -E 's/.*`([^`]+)`.*/\1/' | head -1)
      
      # Try alternative extraction
      if [ -z "$FAILED_MIGRATION" ]; then
        FAILED_MIGRATION=$(echo "$MIGRATION_OUTPUT" | grep -oE '[0-9]{8}_[a-zA-Z_]+|add_[a-zA-Z_]+' | head -1)
      fi
      
      if [ -n "$FAILED_MIGRATION" ]; then
        echo "Resolving failed migration: $FAILED_MIGRATION" >&2
        npx prisma migrate resolve --rolled-back "$FAILED_MIGRATION" 2>&1 || {
          echo "Could not resolve as rolled-back, trying as applied..." >&2
          npx prisma migrate resolve --applied "$FAILED_MIGRATION" 2>&1 || true
        }
        echo "Retrying migrations..." >&2
        npx prisma migrate deploy >&2 || echo "Migration retry failed, continuing..." >&2
      else
        echo "Could not extract failed migration name from output" >&2
      fi
    # Check if the error is about columns already existing
    elif echo "$MIGRATION_OUTPUT" | grep -qi "already exists"; then
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
    # Check if database is completely empty (can't reach or no tables)
    elif echo "$MIGRATION_OUTPUT" | grep -qi "Can't reach database\|P1001"; then
      echo "⚠️ Database connection error during migrations." >&2
      echo "⚠️ Retrying after delay..." >&2
      sleep 5
      
      # Retry migration deployment
      echo "Retrying migrations..." >&2
      RETRY_OUTPUT=$(npx prisma migrate deploy 2>&1)
      RETRY_EXIT=$?
      
      if [ $RETRY_EXIT -eq 0 ]; then
        echo "$RETRY_OUTPUT" >&2
        echo "✅ Migrations completed successfully on retry" >&2
      else
        echo "$RETRY_OUTPUT" >&2
        echo "❌ Migrations still failing after retry." >&2
        echo "⚠️ Attempting to use db push as fallback..." >&2
        PUSH_OUTPUT=$(npx prisma db push --accept-data-loss --skip-generate 2>&1)
        PUSH_EXIT=$?
        echo "$PUSH_OUTPUT" >&2
        if [ $PUSH_EXIT -eq 0 ]; then
          echo "✅ Database schema pushed successfully" >&2
        else
          echo "❌ Database push also failed. Server will start but may have issues." >&2
        fi
      fi
    else
      echo "⚠️ Migration failed with unknown error:" >&2
      echo "$MIGRATION_OUTPUT" >&2
      echo "⚠️ Attempting db push as fallback..." >&2
      PUSH_OUTPUT=$(npx prisma db push --accept-data-loss --skip-generate 2>&1)
      PUSH_EXIT=$?
      echo "$PUSH_OUTPUT" >&2
      if [ $PUSH_EXIT -eq 0 ]; then
        echo "✅ Database schema pushed successfully" >&2
      else
        echo "❌ Database push also failed. Attempting to continue anyway..." >&2
      fi
    fi
  else
    echo "$MIGRATION_OUTPUT" >&2
    echo "✅ Migrations completed successfully" >&2
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
