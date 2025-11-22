-- AlterTable
ALTER TABLE "patterns" ADD COLUMN "genre" TEXT;

-- CreateIndex
CREATE INDEX "patterns_genre_idx" ON "patterns"("genre");

