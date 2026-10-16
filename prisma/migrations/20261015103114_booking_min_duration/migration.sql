ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_duration_min_15m" CHECK ("endsAt" - "startsAt" >= interval '15 minutes');
