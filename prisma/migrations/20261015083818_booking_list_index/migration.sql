-- CreateIndex
CREATE INDEX "Booking_startsAt_id_idx" ON "Booking"("startsAt", "id");

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_duration_max_8h" CHECK ("endsAt" - "startsAt" <= interval '8 hours');
