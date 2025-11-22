#!/bin/sh

# Test if script is running at all - write to a file Railway can't ignore
echo "SCRIPT_STARTED" > /tmp/start.log
echo "Script PID: $$" >> /tmp/start.log
echo "Date: $(date)" >> /tmp/start.log

# Enable shell debugging
set -x

# Write to both stdout and stderr, and also to a file
log() {
  echo "$@" | tee -a /tmp/start.log
  echo "$@" >&1
  echo "$@" >&2
}

log "=== START SCRIPT RUNNING ==="
log "Script started at: $(date)"
log "Current directory: $(pwd)"
log "Node version: $(node --version)"
log "PORT: ${PORT:-not set}"
log "DATABASE_URL: ${DATABASE_URL:+set}"
log "NODE_ENV: ${NODE_ENV:-not set}"

# List files to verify we're in the right place
log "Files in current directory:"
ls -la | head -10 | while read line; do log "$line"; done

# Skip migrations if they're already applied - just start the server
if [ -n "$DATABASE_URL" ]; then
  log "=== Quick migration check ==="
  # Just check if migrations are needed, don't wait
  npx prisma migrate deploy --skip-seed 2>&1 | head -20 | while read line; do log "$line"; done || log "Migration check done"
  log "=== Migration check complete, starting server ==="
else
  log "⚠️  DATABASE_URL not set, skipping migrations"
fi

log ""
log "========================================="
log "=== STARTING SERVER NOW ==="
log "========================================="
log "Working directory: $(pwd)"
log "PORT: ${PORT:-not set}"
log ""

# Verify index.js exists
if [ ! -f "index.js" ]; then
  log "❌ ERROR: index.js not found in $(pwd)"
  log "Files in directory:"
  ls -la | while read line; do log "$line"; done
  exit 1
fi

log "✅ index.js found"
log "🚀 EXECUTING: node index.js"
log "If you don't see server logs after this, node is crashing"
log ""

# Write final status to log file
echo "ABOUT_TO_START_NODE" >> /tmp/start.log

# Start the server - don't redirect, let it write to stdout/stderr naturally
exec node index.js
