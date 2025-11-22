-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "oauth_provider" TEXT NOT NULL,
    "oauth_id" TEXT NOT NULL,
    "avatar_url" TEXT,
    "artist_name" TEXT,
    "social_links" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patterns" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "element_id" TEXT,
    "pattern_code" TEXT NOT NULL,
    "title" TEXT,
    "artist_name" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "version_name" TEXT,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "user_count" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patterns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pattern_shares" (
    "id" TEXT NOT NULL,
    "pattern_id" TEXT NOT NULL,
    "shared_with_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pattern_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_oauth_provider_oauth_id_key" ON "users"("oauth_provider", "oauth_id");

-- CreateIndex
CREATE INDEX "patterns_user_id_idx" ON "patterns"("user_id");

-- CreateIndex
CREATE INDEX "patterns_is_public_idx" ON "patterns"("is_public");

-- CreateIndex
CREATE INDEX "patterns_type_idx" ON "patterns"("type");

-- CreateIndex
CREATE UNIQUE INDEX "pattern_shares_pattern_id_shared_with_user_id_key" ON "pattern_shares"("pattern_id", "shared_with_user_id");

-- CreateIndex
CREATE INDEX "pattern_shares_shared_with_user_id_idx" ON "pattern_shares"("shared_with_user_id");

-- AddForeignKey
ALTER TABLE "patterns" ADD CONSTRAINT "patterns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pattern_shares" ADD CONSTRAINT "pattern_shares_pattern_id_fkey" FOREIGN KEY ("pattern_id") REFERENCES "patterns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pattern_shares" ADD CONSTRAINT "pattern_shares_shared_with_user_id_fkey" FOREIGN KEY ("shared_with_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
