import { Role } from '../generated/prisma/client';

// Pure functions without database access: easy to unit test.
// Each returns an error message, or undefined when the rule holds.

export const MIN_BOOKING_DURATION_MS = 15 * 60 * 1000;
export const MAX_BOOKING_DURATION_MS = 8 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

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

// Owner or admin: used by GET /bookings/:id, PATCH and cancel
export function canAccessBooking(
  user: { id: string; role: Role },
  ownerId: string,
): boolean {
  return user.role === Role.admin || user.id === ownerId;
}

export function earliestStartEndingAfter(moment: Date): Date {
  return new Date(moment.getTime() - MAX_BOOKING_DURATION_MS);
}

export function availabilityWindow(
  date: string,
  now: Date,
): { from: Date; to: Date } | undefined {
  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);
  const nextMinute = new Date(Math.ceil(now.getTime() / MINUTE_MS) * MINUTE_MS);
  const from = nextMinute > dayStart ? nextMinute : dayStart;

  return from < dayEnd ? { from, to: dayEnd } : undefined;
}

export function findFreeSlots(
  busy: { startsAt: Date; endsAt: Date }[],
  from: Date,
  to: Date,
): { startsAt: Date; endsAt: Date }[] {
  const slots: { startsAt: Date; endsAt: Date }[] = [];
  let cursor = from;

  for (const booking of busy) {
    if (booking.startsAt > cursor) {
      slots.push({
        startsAt: cursor,
        endsAt: booking.startsAt < to ? booking.startsAt : to,
      });
    }
    if (booking.endsAt > cursor) {
      cursor = booking.endsAt;
    }
  }
  if (cursor < to) {
    slots.push({ startsAt: cursor, endsAt: to });
  }

  return slots.filter(
    (slot) =>
      slot.endsAt.getTime() - slot.startsAt.getTime() >=
      MIN_BOOKING_DURATION_MS,
  );
}
