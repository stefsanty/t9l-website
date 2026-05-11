-- v1.95.0 — admin RSVP override audit fields on Availability.
--
-- Two additive nullable columns + one FK. Backs the new admin-only
-- override-RSVP section in the AddGuestsModal (per-team, per-matchday).
--
--   overriddenById  → admin User.id; FK ON DELETE SET NULL so historical
--                     overrides survive admin User deletion with NULL.
--   overriddenAt    → distinct from `updatedAt` (which fires on every
--                     touch, including user re-RSVPs via /api/rsvp).
--
-- Lifecycle:
--   - Admin override write (setMatchdayGuests with rsvpOverrides) sets
--     both fields to (adminUserId, now()).
--   - User re-RSVP through /api/rsvp clears both back to NULL — the
--     player taking ownership back means the row is no longer
--     "currently overridden" in the audit sense.
--
-- Rollback:
--   ALTER TABLE "Availability" DROP CONSTRAINT "Availability_overriddenById_fkey";
--   ALTER TABLE "Availability" DROP COLUMN "overriddenAt";
--   ALTER TABLE "Availability" DROP COLUMN "overriddenById";

-- AlterTable
ALTER TABLE "Availability" ADD COLUMN     "overriddenAt" TIMESTAMP(3),
ADD COLUMN     "overriddenById" TEXT;

-- AddForeignKey
ALTER TABLE "Availability" ADD CONSTRAINT "Availability_overriddenById_fkey" FOREIGN KEY ("overriddenById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
