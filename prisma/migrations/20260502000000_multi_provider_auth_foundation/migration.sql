-- Multi-provider auth foundation (v1.28.0) — additive schema only.
-- See outputs/account-player-rework-plan.md §3 "Stage α.5" for the full plan.
--
-- This migration is purely additive:
--   - User.email          (nullable @unique)  — NextAuth adapter requirement
--   - User.emailVerified  (nullable timestamp) — adapter EmailProvider field
--   - Account             (new table)         — NextAuth multi-provider join
--   - VerificationToken   (new table)         — EmailProvider magic-link tokens
--
-- No code in src/ changes its READ behavior in this stage. The auth.ts
-- changes wire the PrismaAdapter and add GoogleProvider + EmailProvider but
-- the LINE branch's resolution path is untouched. Existing LINE users see
-- no behavior change post-merge IF the pre-α.5 backfill has populated
-- Account(provider="line") rows for them BEFORE the first LINE login post-
-- deploy. Otherwise the adapter creates a duplicate User row on first sign-in.
--
-- Rollback: drop the new columns/tables. The stage α.5 schema is fully
-- revertible via `DROP COLUMN` / `DROP TABLE`. Backfilled Account rows are
-- harmless to leave in place (cascade-deleted with their User).

-- AlterTable: add User.email + User.emailVerified + User.image
ALTER TABLE "User" ADD COLUMN "email" TEXT;
ALTER TABLE "User" ADD COLUMN "emailVerified" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "image" TEXT;
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateTable: Account
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- AddForeignKey: Account.userId → User.id
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: VerificationToken
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");
