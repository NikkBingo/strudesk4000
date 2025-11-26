/**
 * Shared Prisma client instance
 * Import this instead of creating new PrismaClient instances
 */

import { PrismaClient } from '@prisma/client';

const logLevels = process.env.NODE_ENV === 'development'
  ? ['query', 'error', 'warn']
  : ['error'];

// Use globalThis to ensure single instance across hot reloads (e.g., dev)
if (!globalThis.__strudelPrisma) {
  globalThis.__strudelPrisma = new PrismaClient({
    log: logLevels,
  });
}

const prisma = globalThis.__strudelPrisma;

const MAX_RETRIES = Number(process.env.PRISMA_CONNECTION_MAX_RETRIES || 10);
const RETRY_DELAY_MS = Number(process.env.PRISMA_CONNECTION_RETRY_DELAY || 3000);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Parse DATABASE_URL to extract connection info (without password)
 */
function parseDatabaseUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return {
      protocol: parsed.protocol,
      host: parsed.hostname,
      port: parsed.port || '5432',
      database: parsed.pathname?.slice(1) || 'unknown',
      user: parsed.username || 'unknown',
      hasPassword: !!parsed.password
    };
  } catch {
    return null;
  }
}

/**
 * Log database connection diagnostics
 */
function logDatabaseDiagnostics() {
  const dbUrl = process.env.DATABASE_URL;
  
  if (!dbUrl) {
    console.error('❌ DATABASE_URL environment variable is not set');
    console.error('   → Check Railway: App Service → Variables → DATABASE_URL');
    console.error('   → DATABASE_URL should be set automatically when Postgres service is linked');
    return;
  }
  
  const dbInfo = parseDatabaseUrl(dbUrl);
  if (dbInfo) {
    console.log('📊 Database Connection Info:');
    console.log(`   Host: ${dbInfo.host}:${dbInfo.port}`);
    console.log(`   Database: ${dbInfo.database}`);
    console.log(`   User: ${dbInfo.user}`);
    console.log(`   Protocol: ${dbInfo.protocol}`);
    
    // Check if using Railway internal network
    if (dbInfo.host.includes('railway.internal')) {
      console.log('   ✅ Using Railway internal network (postgres.railway.internal)');
      console.log('   → This requires Postgres service to be linked as a dependency');
    } else if (dbInfo.host.includes('railway.app')) {
      console.log('   ⚠️  Using Railway public domain (may require SSL)');
    } else {
      console.log('   ℹ️  Using external/custom database host');
    }
  } else {
    console.error('❌ DATABASE_URL format is invalid');
    console.error(`   Current value (first 50 chars): ${dbUrl.substring(0, 50)}...`);
  }
  
  // Check Railway environment
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    console.log('🚂 Railway Environment Detected:');
    console.log(`   Public Domain: ${process.env.RAILWAY_PUBLIC_DOMAIN}`);
    console.log('   → Ensure Postgres service is running and linked as dependency');
  }
}

async function connectWithRetry(attempt = 1) {
  // Log diagnostics on first attempt
  if (attempt === 1) {
    logDatabaseDiagnostics();
  }
  
  try {
    await prisma.$connect();
    if (attempt > 1) {
      console.log(`✅ Prisma reconnected after ${attempt - 1} retries`);
    } else {
      console.log('✅ Prisma connected successfully');
      const dbInfo = parseDatabaseUrl(process.env.DATABASE_URL);
      if (dbInfo) {
        console.log(`   Connected to: ${dbInfo.host}:${dbInfo.port}/${dbInfo.database}`);
      }
    }
  } catch (error) {
    const isDbUnreachable = error.code === 'P1001' || error.message?.includes('P1001');
    const isAuthError = error.code === 'P1000' || error.message?.includes('P1000');
    const isTimeout = error.message?.includes('timeout') || error.message?.includes('ETIMEDOUT');
    
    console.error(`❌ Prisma connection attempt ${attempt}/${MAX_RETRIES} failed`);
    console.error(`   Error code: ${error.code || 'unknown'}`);
    console.error(`   Error message: ${error.message || error}`);
    
    if (isDbUnreachable) {
      console.error('   🔍 Diagnosis: Database server is unreachable');
      console.error('   💡 Troubleshooting steps:');
      console.error('      1. Check if Postgres service is running in Railway');
      console.error('      2. Verify service dependencies: App Service → Settings → Dependencies');
      console.error('      3. Ensure Postgres service is listed as a dependency');
      console.error('      4. Check Postgres service logs for errors');
      console.error('      5. Try restarting the Postgres service first, then the app service');
    } else if (isAuthError) {
      console.error('   🔍 Diagnosis: Authentication failed');
      console.error('   💡 Check DATABASE_URL credentials in Railway variables');
    } else if (isTimeout) {
      console.error('   🔍 Diagnosis: Connection timeout');
      console.error('   💡 Database may be slow to start or network issues');
    }
    
    if (attempt >= MAX_RETRIES) {
      console.error('❌ Prisma connection failed after maximum retries');
      console.error('⚠️  Server will continue running but database features will not work');
      console.error('⚠️  Authentication and data persistence will be unavailable');
      // Don't throw - let server continue without database
      return;
    }
    
    const delay = RETRY_DELAY_MS * attempt;
    console.log(`⏳ Retrying Prisma connection in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
    await wait(delay);
    return connectWithRetry(attempt + 1);
  }
}

const prismaReady = connectWithRetry();

// Handle graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

export { prismaReady };
export default prisma;

