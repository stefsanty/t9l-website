-- CreateTable: LineLogin
-- Tracks every distinct LINE user that has authenticated against the public
-- site, regardless of whether they've been linked to a Player record. Powers
-- the admin "Assign Player" Flow B orphan-user dropdown introduced in PR 6.
--
-- `lineId` is unique (each LINE user collapses to one row). `firstSeenAt` is
-- set once at insert; `lastSeenAt` is bumped on every subsequent login via
-- @updatedAt. Index on lastSeenAt supports ORDER BY for the admin UI.

CREATE TABLE "LineLogin" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "name" TEXT,
    "pictureUrl" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LineLogin_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LineLogin_lineId_key" ON "LineLogin"("lineId");
CREATE INDEX "LineLogin_lastSeenAt_idx" ON "LineLogin"("lastSeenAt");
