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

**Option 2: Using Railway Dashboard**

1. Go to your Railway dashboard: https://railway.app
2. Select your `strudesk4000` service
3. Open the "Deployments" tab
4. Click on the latest deployment
5. Open the "Shell" tab
6. Run:
   ```bash
   cd server
   npx prisma migrate resolve --applied 20241124_add_email_auth_fields
   npx prisma migrate deploy
   ```

## Alternative: Automatic Resolution

The `start.sh` script now automatically detects and resolves "already exists" errors during deployment. After the next deployment with the updated script, migrations should resolve automatically.

## Important Note

**The internal Railway database URL (`postgres.railway.internal:5432`) is NOT accessible from your local machine.** 

- ❌ **Don't run** `prisma migrate resolve` locally with `DATABASE_URL` - it will fail with "Can't reach database server"
- ✅ **Do run** the command inside Railway shell where the internal URL works
- ✅ **Or wait** for the automatic resolution on next deployment

