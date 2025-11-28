-- Track per-user daily adds to prevent duplicate increments
CREATE TABLE "pattern_load_events" (
    "pattern_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date_key" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pattern_load_events_pkey" PRIMARY KEY ("pattern_id", "user_id", "date_key")
);

-- Maintain referential integrity
ALTER TABLE "pattern_load_events"
ADD CONSTRAINT "pattern_load_events_pattern_id_fkey"
FOREIGN KEY ("pattern_id") REFERENCES "patterns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pattern_load_events"
ADD CONSTRAINT "pattern_load_events_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

