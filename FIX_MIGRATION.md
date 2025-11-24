# Fix Failed Migration

If you see a migration error like "column already exists", you can manually resolve it:

## On Railway

1. Connect to Railway CLI:
   ```bash
   railway shell
   ```

2. Navigate to server directory:
   ```bash
   cd server
   ```

3. Resolve the specific migration:
   ```bash
   npx prisma migrate resolve --applied 20241124_add_email_auth_fields
   ```

4. Verify migrations are applied:
   ```bash
   npx prisma migrate deploy
   ```

## Alternative: Automatic Resolution

The `start.sh` script now automatically detects and resolves "already exists" errors during deployment. However, if you need to manually resolve:

The migration name in the error message is: `20241124_add_email_auth_fields`

Run this command on Railway:
```bash
railway shell
cd server
npx prisma migrate resolve --applied 20241124_add_email_auth_fields
```

