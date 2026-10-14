// Pure functions without database access: easy to unit test.
// Each returns an error message, or undefined when the rule holds.

export const MIN_BOOKING_DURATION_MS = 15 * 60 * 1000;
export const MAX_BOOKING_DURATION_MS = 8 * 60 * 60 * 1000;

export function checkBookingTime(
  startsAt: Date,
  endsAt: Date,
  now: Date,
): string | undefined {
  if (startsAt >= endsAt) {
    return 'startsAt must be earlier than endsAt';
  }

  const duration = endsAt.getTime() - startsAt.getTime();
  if (duration < MIN_BOOKING_DURATION_MS) {
    return 'Booking must last at least 15 minutes';
  }
  if (duration > MAX_BOOKING_DURATION_MS) {
    return 'Booking must not last longer than 8 hours';
  }

  if (startsAt < now) {
    return 'startsAt must not be in the past';
  }

  return undefined;
}

export function checkRoomForBooking(
  room: { isActive: boolean; capacity: number },
  attendeesCount: number,
): string | undefined {
  if (!room.isActive) {
    return 'Room is not active';
  }
  if (attendeesCount > room.capacity) {
    return `attendeesCount must not exceed the room capacity (${room.capacity})`;
  }

  return undefined;
}
