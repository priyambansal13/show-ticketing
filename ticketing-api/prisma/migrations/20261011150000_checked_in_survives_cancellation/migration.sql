-- A check-in is a historical fact: it stays on a booking that is later cancelled
-- (e.g. the organiser calls off the show after doors opened and refunds everyone).
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_checked_in_chk";
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_checked_in_chk" CHECK ("checked_in_at" IS NULL OR "status" IN ('CONFIRMED', 'CANCELLED'));
