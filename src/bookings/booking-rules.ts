import { DAY_MS, HOUR_MS, MINUTE_MS } from '../common/utils/time';
import { Role } from '../generated/prisma/client';

// Pure functions without database access: easy to unit test.
// The check* functions return an error message, or undefined when the rule holds.

export const MIN_BOOKING_DURATION_MS = 15 * MINUTE_MS;
export const MAX_BOOKING_DURATION_MS = 8 * HOUR_MS;
export const MAX_BOOKING_ADVANCE_MS = 365 * DAY_MS;

// The latest start a booking made at `now` may have (inclusive)
export function latestAllowedStart(now: Date): Date {
  return new Date(now.getTime() + MAX_BOOKING_ADVANCE_MS);
}

// currentStartsAt is the start before a PATCH. A booking that is going on has
// its start in the past: an unchanged start is allowed, only the end must be
// ahead (so the meeting can be extended). A new start must not be in the past
// and not more than 365 days ahead.
export function checkBookingTime(
  startsAt: Date,
  endsAt: Date,
  now: Date,
  currentStartsAt?: Date,
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

  const startChanged = startsAt.getTime() !== currentStartsAt?.getTime();
  if (startChanged && startsAt < now) {
    return 'startsAt must not be in the past';
  }
  if (startChanged && startsAt > latestAllowedStart(now)) {
    return 'startsAt must be at most 365 days ahead';
  }
  if (endsAt <= now) {
    return 'endsAt must be in the future';
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

// An ended booking is history: PATCH and cancel are rejected. A booking that
// is going on can still be changed or cancelled
export function hasEnded(booking: { endsAt: Date }, now: Date): boolean {
  return booking.endsAt <= now;
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
  const lastStart = latestAllowedStart(now);
  const to = lastStart < dayEnd ? lastStart : dayEnd;

  return from < to ? { from, to } : undefined;
}

// Free time is cut at the end of the window (midnight UTC or the 365-day limit),
// but a slot that starts in the window is bookable if the room stays free for
// 15 minutes, even past the cut. So busy bookings are needed up to this moment
export function freeSlotLookupEnd(to: Date): Date {
  return new Date(to.getTime() + MIN_BOOKING_DURATION_MS);
}

// busy: confirmed bookings sorted by startsAt, covering at least [from, freeSlotLookupEnd(to)).
// A slot is reported only if the room is free for at least 15 minutes from its
// start; the end of the last slot is cut at `to`, so it can be shorter
export function findFreeSlots(
  busy: { startsAt: Date; endsAt: Date }[],
  from: Date,
  to: Date,
): { startsAt: Date; endsAt: Date }[] {
  const lookupEnd = freeSlotLookupEnd(to);
  const slots: { startsAt: Date; endsAt: Date }[] = [];
  let cursor = from;

  for (const booking of busy) {
    if (booking.startsAt > cursor) {
      slots.push({
        startsAt: cursor,
        endsAt: booking.startsAt < lookupEnd ? booking.startsAt : lookupEnd,
      });
    }
    if (booking.endsAt > cursor) {
      cursor = booking.endsAt;
    }
  }
  if (cursor < lookupEnd) {
    slots.push({ startsAt: cursor, endsAt: lookupEnd });
  }

  return slots
    .filter(
      (slot) =>
        slot.startsAt < to &&
        slot.endsAt.getTime() - slot.startsAt.getTime() >=
          MIN_BOOKING_DURATION_MS,
    )
    .map((slot) => ({
      startsAt: slot.startsAt,
      endsAt: slot.endsAt < to ? slot.endsAt : to,
    }));
}
