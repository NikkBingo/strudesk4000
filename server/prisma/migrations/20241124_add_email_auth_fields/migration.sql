-- Alter users table to support local auth and account state
ALTER TABLE "users"
  ADD COLUMN "password_hash" TEXT,
  ADD COLUMN "email_verified_at" TIMESTAMP(3),
  ADD COLUMN "verification_token" TEXT,
  ADD COLUMN "verification_token_expires" TIMESTAMP(3),
  ADD COLUMN "reset_token" TEXT,
  ADD COLUMN "reset_token_expires" TIMESTAMP(3),
  ADD COLUMN "role" TEXT NOT NULL DEFAULT 'user',
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN "profile_completed" BOOLEAN NOT NULL DEFAULT false;

-- Indexes for token lookups
CREATE INDEX IF NOT EXISTS "users_verification_token_idx" ON "users"("verification_token");
CREATE INDEX IF NOT EXISTS "users_reset_token_idx" ON "users"("reset_token");

