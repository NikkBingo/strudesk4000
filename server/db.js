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

async function connectWithRetry(attempt = 1) {
  try {
    await prisma.$connect();
    if (attempt > 1) {
      console.log(`✅ Prisma reconnected after ${attempt - 1} retries`);
    } else {
      console.log('✅ Prisma connected');
    }
  } catch (error) {
    const isDbUnreachable = error.code === 'P1001' || error.message?.includes('P1001');
    console.error(`❌ Prisma connection attempt ${attempt} failed${isDbUnreachable ? ' (database unreachable)' : ''}:`, error.message || error);
    
    if (attempt >= MAX_RETRIES) {
      console.error('❌ Prisma connection failed after maximum retries');
      throw error;
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

