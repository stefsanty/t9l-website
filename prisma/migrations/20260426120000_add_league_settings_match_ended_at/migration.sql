-- AlterTable
ALTER TABLE "League" ADD COLUMN "description" TEXT,
ADD COLUMN "subdomain" TEXT;

-- AlterTable
ALTER TABLE "Match" ADD COLUMN "endedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "League_subdomain_key" ON "League"("subdomain");
