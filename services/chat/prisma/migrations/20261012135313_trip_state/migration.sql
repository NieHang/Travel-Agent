-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "tripRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tripState" JSONB;
