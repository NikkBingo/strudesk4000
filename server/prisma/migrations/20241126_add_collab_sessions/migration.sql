-- CreateTable
CREATE TABLE "collab_sessions" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "master_code" TEXT,
    "merged_stack" TEXT,
    "apply_delay_ms" INTEGER NOT NULL DEFAULT 0,
    "cpu_stats" JSONB DEFAULT '{}',
    "settings" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collab_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_participants" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_channels" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "element_id" TEXT,
    "name" TEXT,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "volume_db" DOUBLE PRECISION,
    "pan" DOUBLE PRECISION,
    "metadata" JSONB DEFAULT '{}',
    "last_evaluated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_channel_revisions" (
    "id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "applied_to_master" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_channel_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "collab_sessions_slug_key" ON "collab_sessions"("slug");

-- CreateIndex
CREATE INDEX "collab_sessions_owner_id_idx" ON "collab_sessions"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_participants_session_id_user_id_key" ON "session_participants"("session_id", "user_id");

-- CreateIndex
CREATE INDEX "session_participants_user_id_idx" ON "session_participants"("user_id");

-- CreateIndex
CREATE INDEX "session_channels_session_id_idx" ON "session_channels"("session_id");

-- CreateIndex
CREATE INDEX "session_channels_user_id_idx" ON "session_channels"("user_id");

-- CreateIndex
CREATE INDEX "session_channel_revisions_session_id_idx" ON "session_channel_revisions"("session_id");

-- CreateIndex
CREATE INDEX "session_channel_revisions_user_id_idx" ON "session_channel_revisions"("user_id");

-- AddForeignKey
ALTER TABLE "collab_sessions" ADD CONSTRAINT "collab_sessions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_participants" ADD CONSTRAINT "session_participants_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "collab_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_participants" ADD CONSTRAINT "session_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_channels" ADD CONSTRAINT "session_channels_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "collab_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_channels" ADD CONSTRAINT "session_channels_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_channel_revisions" ADD CONSTRAINT "session_channel_revisions_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "session_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_channel_revisions" ADD CONSTRAINT "session_channel_revisions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "collab_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_channel_revisions" ADD CONSTRAINT "session_channel_revisions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
