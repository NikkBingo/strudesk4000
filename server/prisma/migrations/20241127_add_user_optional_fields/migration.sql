-- Add optional personal info fields to users table
ALTER TABLE "users"
ADD COLUMN "first_name" TEXT,
ADD COLUMN "last_name" TEXT,
ADD COLUMN "birth_date" TIMESTAMP(3),
ADD COLUMN "city" TEXT,
ADD COLUMN "country" TEXT;

