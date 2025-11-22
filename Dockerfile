FROM node:18-alpine

WORKDIR /app

# Install OpenSSL and other dependencies for Prisma
RUN apk add --no-cache openssl openssl-dev libc6-compat

# Set Prisma to use OpenSSL 3.x (default in Alpine)
ENV PRISMA_OPENSSL_VERSION=openssl-3.0.x

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

# Expose port
EXPOSE 3001

# Run migrations and start server
# Use a script that handles missing DATABASE_URL gracefully
CMD ["sh", "-c", "if [ -n \"$DATABASE_URL\" ]; then npx prisma migrate deploy; fi && npm start"]

