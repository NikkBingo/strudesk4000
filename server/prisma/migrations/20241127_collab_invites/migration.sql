-- Add unique constraint for display names
ALTER TABLE "users" ADD CONSTRAINT "users_name_key" UNIQUE ("name");

-- Create collaboration invites table
CREATE TABLE "collab_invites" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "inviter_id" TEXT NOT NULL,
    "invitee_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMP(3),
    CONSTRAINT "collab_invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "collab_invites_session_id_invitee_id_key" ON "collab_invites" ("session_id", "invitee_id");
CREATE INDEX "collab_invites_session_id_idx" ON "collab_invites" ("session_id");
CREATE INDEX "collab_invites_invitee_id_idx" ON "collab_invites" ("invitee_id");
CREATE INDEX "collab_invites_inviter_id_idx" ON "collab_invites" ("inviter_id");

ALTER TABLE "collab_invites" ADD CONSTRAINT "collab_invites_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "collab_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collab_invites" ADD CONSTRAINT "collab_invites_inviter_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collab_invites" ADD CONSTRAINT "collab_invites_invitee_id_fkey" FOREIGN KEY ("invitee_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
