-- Written by hand: Prisma schema cannot describe CHECK and EXCLUDE constraints

-- Lets one GiST index combine "=" on roomId with "&&" (overlaps) on a time range
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_startsAt_before_endsAt" CHECK ("startsAt" < "endsAt");

-- Two confirmed bookings of one room cannot overlap in time, even when the
-- requests arrive at the same moment. '[)' includes the start and excludes the
-- end, so 10:00-11:00 and 11:00-12:00 do not overlap. Cancelled bookings are
-- ignored, so cancelling frees the slot.
ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_no_overlap" EXCLUDE USING gist (
    "roomId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  ) WHERE (status = 'confirmed');
