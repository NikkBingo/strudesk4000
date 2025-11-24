# Fix Failed Migration

If you see a migration error like "column already exists", you can manually resolve it:

## On Railway (Recommended)

**Option 1: Using Railway Shell (Easiest)**

1. Make sure you're linked to the correct Railway project:
   ```bash
   railway link
   ```
   (If you see "Project: strudesk4000", you're good. If not, select the project.)

2. Connect to Railway shell:
   ```bash
   railway shell
   ```

3. Navigate to server directory:
   ```bash
   cd server
   ```

4. Resolve the specific migration:
   ```bash
   npx prisma migrate resolve --applied 20241124_add_email_auth_fields
   ```

5. Verify migrations are applied:
   ```bash
   npx prisma migrate deploy
   ```

**Option 2: Using Railway Dashboard (Web UI)**

Railway's web interface doesn't have a direct "Shell" tab. Instead, you have these options:

**Method A: Use Railway CLI with correct service**

1. Link to the correct service:
   ```bash
   railway link
   ```
   When prompted, select:
   - Project: **Strudesk 4000**
   - Service: **strudesk4000** (NOT Postgres)

2. Then run the command through Railway's network:
   ```bash
   railway run cd server && npx prisma migrate resolve --applied 20241124_add_email_auth_fields
   railway run cd server && npx prisma migrate deploy
   ```

**Method B: Wait for automatic resolution (Easiest)**

The updated `start.sh` script will automatically resolve the migration on the next deployment. Just push your code and wait for the deployment to complete - the script will handle it automatically!

**Method C: Use Railway API/CLI to execute command in container**

If you have Railway CLI installed:
```bash
railway run --service strudesk4000 -- npx prisma migrate resolve --applied 20241124_add_email_auth_fields
railway run --service strudesk4000 -- npx prisma migrate deploy
```

**Note:** The migration resolution script in `start.sh` should handle this automatically on the next deployment!

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

## Important Note

**The internal Railway database URL (`postgres.railway.internal:5432`) is NOT accessible from your local machine.** 

- ❌ **Don't run** `prisma migrate resolve` locally - it will fail with "Can't reach database server at `postgres.railway.internal:5432`"
- ✅ **Do run** the command inside Railway shell (using `railway shell`) where the internal URL works
- ✅ **Or wait** for the automatic resolution on next deployment

**The error you're seeing:**
```
Error: P1001: Can't reach database server at `postgres.railway.internal:5432`
```

This is **normal** when running locally. You **must** use `railway shell` to connect to Railway's network first.

