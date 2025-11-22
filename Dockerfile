FROM node:18-alpine

WORKDIR /app

# Install OpenSSL for Prisma (Alpine 3.21+ uses OpenSSL 3.x by default)
RUN apk add --no-cache openssl

# Copy server package files
COPY server/package.json server/package-lock.json ./

# Install dependencies
RUN npm ci

# Copy Prisma schema
COPY server/prisma ./prisma

# Generate Prisma client (doesn't need DATABASE_URL)
RUN npx prisma generate

# Copy server application code
COPY server/ ./

# Make start script executable
RUN chmod +x start.sh

# Expose port
EXPOSE 3001

# Run migrations and start server using startup script
CMD ["./start.sh"]

