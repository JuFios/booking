-- Booking_duration_min_15m ("endsAt" - "startsAt" >= 15 minutes) already
-- implies "startsAt" < "endsAt"
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_startsAt_before_endsAt";
