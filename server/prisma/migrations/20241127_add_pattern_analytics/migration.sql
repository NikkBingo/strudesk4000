-- Create table to track aggregate analytics for each pattern
CREATE TABLE "pattern_analytics" (
    "pattern_id" TEXT NOT NULL,
    "master_load_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pattern_analytics_pkey" PRIMARY KEY ("pattern_id")
);

-- Maintain referential integrity with the parent pattern
ALTER TABLE "pattern_analytics"
ADD CONSTRAINT "pattern_analytics_pattern_id_fkey"
FOREIGN KEY ("pattern_id") REFERENCES "patterns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

