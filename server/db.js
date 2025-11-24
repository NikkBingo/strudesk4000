/**
 * Shared Prisma client instance
 * Import this instead of creating new PrismaClient instances
 */

import { PrismaClient } from '@prisma/client';

let prisma;

// Singleton pattern - reuse the same PrismaClient instance
if (!prisma) {
  prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });
}

// Handle graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

export default prisma;

