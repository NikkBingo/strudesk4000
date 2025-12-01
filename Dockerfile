FROM node:18-alpine AS frontend-builder

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json ./

# Install dependencies
# Use npm install with legacy-peer-deps to handle peer dependency issues
RUN npm install --legacy-peer-deps --no-audit

# Copy frontend source files
COPY vite.config.js ./
COPY index.html ./
COPY src ./src
COPY assets ./assets

# Build frontend
RUN npm run build

# Server stage
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

# Copy built frontend from builder stage
COPY --from=frontend-builder /app/dist ./public

# Make start script executable
RUN chmod +x start.sh

# Expose port
EXPOSE 3001

# Start via start.sh to handle Prisma generation/migrations on boot
CMD ["./start.sh"]

