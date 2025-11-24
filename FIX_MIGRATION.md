# Fix Failed Migration

If you see a migration error like "column already exists", you can manually resolve it:

## On Railway (Recommended)

**Option 1: Using Railway CLI `run` command (Actually works!)**

**Important:** `railway shell` only sets environment variables - it doesn't connect you to Railway's network. You need to use `railway run` which executes commands **inside** the Railway container.

1. Make sure you're linked to the correct Railway service:
   ```bash
   railway link
   ```
   Select: Project "Strudesk 4000", Service "strudesk4000" (NOT Postgres)

2. Run the command **inside** Railway's container (with explicit schema path):
   ```bash
   railway run --service strudesk4000 -- npx prisma migrate resolve --applied 20241124_add_email_auth_fields --schema=/app/prisma/schema.prisma
   ```
   
   (The Prisma schema is at `/app/prisma/schema.prisma` in the container)

3. Verify migrations are applied:
   ```bash
   railway run --service strudesk4000 -- npx prisma migrate deploy --schema=/app/prisma/schema.prisma
   ```

**Note:** The `--service strudesk4000` flag ensures you're running it in the correct service (where DATABASE_URL is accessible).

**Option 2: Wait for Automatic Resolution (Recommended - Easiest!)**

The updated `start.sh` script will automatically resolve the migration on the next deployment. Just push your code and wait for the deployment to complete - the script will handle it automatically!

No manual intervention needed! ✨

## Alternative: Automatic Resolution

The `start.sh` script now automatically detects and resolves "already exists" errors during deployment. After the next deployment with the updated script, migrations should resolve automatically.

## Quick Fix Script

You can use the provided script to easily connect to Railway:

```bash
./resolve-migration-railway.sh
```

Then run:
```bash
cd server
npx prisma migrate resolve --applied 20241124_add_email_auth_fields
npx prisma migrate deploy
```

## Important Notes

**Why `railway shell` doesn't work:**
- `railway shell` only sets environment variables locally - it doesn't give you network access
- The internal Railway database URL (`postgres.railway.internal:5432`) is **only** accessible from **inside** Railway containers
- You need `railway run` to execute commands inside the container

**The error you're seeing:**
```
Error: P1001: Can't reach database server at `postgres.railway.internal:5432`
```

This happens because:
- ❌ **`railway shell`** - only sets env vars locally (no network access)
- ✅ **`railway run`** - executes commands inside Railway's container (has network access)

**Recommended:** Just wait for automatic resolution on the next deployment - it's the easiest option!

