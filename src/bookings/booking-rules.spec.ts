import { HOUR_MS, MINUTE_MS } from '../common/utils/time';
import {
  availabilityWindow,
  checkBookingTime,
  findFreeSlots,
  hasEnded,
  MAX_BOOKING_ADVANCE_MS,
} from './booking-rules';

const now = new Date('2026-10-20T10:30:00Z');
const at = (time: string) => new Date(`2026-10-20T${time}Z`);
const later = (date: Date, ms: number) => new Date(date.getTime() + ms);

describe('checkBookingTime: start and end relative to now', () => {
  describe('new booking', () => {
    it('accepts a booking that starts in the future', () => {
      expect(checkBookingTime(at('11:00'), at('12:00'), now)).toBeUndefined();
    });

    it('rejects a booking that starts in the past', () => {
      expect(checkBookingTime(at('10:00'), at('11:00'), now)).toBe(
        'startsAt must not be in the past',
      );
    });

    it('accepts a start exactly 365 days ahead', () => {
      const startsAt = later(now, MAX_BOOKING_ADVANCE_MS);
      expect(
        checkBookingTime(startsAt, later(startsAt, HOUR_MS), now),
      ).toBeUndefined();
    });

    it('rejects a start more than 365 days ahead', () => {
      const startsAt = later(now, MAX_BOOKING_ADVANCE_MS + MINUTE_MS);
      expect(checkBookingTime(startsAt, later(startsAt, HOUR_MS), now)).toBe(
        'startsAt must be at most 365 days ahead',
      );
    });
  });

  describe('time change of an existing booking', () => {
    // The meeting 10:00-11:00 is going on: it started before now
    const currentStartsAt = at('10:00');

    it('extends a meeting that is going on', () => {
      expect(
        checkBookingTime(at('10:00'), at('11:30'), now, currentStartsAt),
      ).toBeUndefined();
    });

    it('shortens a meeting that is going on', () => {
      expect(
        checkBookingTime(at('10:00'), at('10:45'), now, currentStartsAt),
      ).toBeUndefined();
    });

    it('rejects an end in the past when the start is kept', () => {
      expect(
        checkBookingTime(at('10:00'), at('10:15'), now, currentStartsAt),
      ).toBe('endsAt must be in the future');
    });

    it('rejects an end equal to now', () => {
      expect(
        checkBookingTime(at('10:00'), at('10:30'), now, currentStartsAt),
      ).toBe('endsAt must be in the future');
    });

    it('rejects moving the start to another moment in the past', () => {
      expect(
        checkBookingTime(at('09:45'), at('11:00'), now, currentStartsAt),
      ).toBe('startsAt must not be in the past');
    });

    it('accepts moving the start to the future', () => {
      expect(
        checkBookingTime(at('11:00'), at('12:00'), now, currentStartsAt),
      ).toBeUndefined();
    });
  });
});

describe('hasEnded: an ended booking cannot be changed or cancelled', () => {
  it('is false for a booking in the future', () => {
    expect(hasEnded({ endsAt: at('12:00') }, now)).toBe(false);
  });

  it('is false for a booking that is going on', () => {
    expect(hasEnded({ endsAt: at('11:00') }, now)).toBe(false);
  });

  it('is true for a booking that ends exactly now', () => {
    expect(hasEnded({ endsAt: at('10:30') }, now)).toBe(true);
  });

  it('is true for a booking in the past', () => {
    expect(hasEnded({ endsAt: at('09:00') }, now)).toBe(true);
  });
});

describe('availabilityWindow: the part of a day that can still be booked', () => {
  it('is the whole day for a future date', () => {
    expect(availabilityWindow('2026-10-25', now)).toEqual({
      from: new Date('2026-10-25T00:00:00Z'),
      to: new Date('2026-10-26T00:00:00Z'),
    });
  });

  it('starts at the next whole minute today', () => {
    expect(
      availabilityWindow('2026-10-20', new Date('2026-10-20T10:30:20Z')),
    ).toEqual({ from: at('10:31'), to: new Date('2026-10-21T00:00:00Z') });
  });

  it('is empty for a past date', () => {
    expect(availabilityWindow('2026-10-19', now)).toBeUndefined();
  });

  it('is empty for a date more than 365 days ahead', () => {
    expect(availabilityWindow('2027-10-21', now)).toBeUndefined();
  });

  it('ends at the last allowed start on the 365th day', () => {
    expect(availabilityWindow('2027-10-20', now)).toEqual({
      from: new Date('2027-10-20T00:00:00Z'),
      to: later(now, MAX_BOOKING_ADVANCE_MS),
    });
  });
});

describe('findFreeSlots: free time of a day', () => {
  const dayStart = new Date('2026-10-21T00:00:00Z');
  const dayEnd = new Date('2026-10-22T00:00:00Z');
  const on = (day: number, time: string) => new Date(`2026-10-${day}T${time}Z`);
  const busy = (startsAt: Date, endsAt: Date) => ({ startsAt, endsAt });

  it('is the whole window for an empty room', () => {
    expect(findFreeSlots([], dayStart, dayEnd)).toEqual([
      { startsAt: dayStart, endsAt: dayEnd },
    ]);
  });

  it('splits the day around a booking', () => {
    expect(
      findFreeSlots([busy(on(21, '10:00'), on(21, '11:00'))], dayStart, dayEnd),
    ).toEqual([
      { startsAt: dayStart, endsAt: on(21, '10:00') },
      { startsAt: on(21, '11:00'), endsAt: dayEnd },
    ]);
  });

  it('drops a gap shorter than 15 minutes between bookings', () => {
    expect(
      findFreeSlots(
        [
          busy(on(21, '10:00'), on(21, '11:00')),
          busy(on(21, '11:10'), on(21, '12:00')),
        ],
        on(21, '10:00'),
        dayEnd,
      ),
    ).toEqual([{ startsAt: on(21, '12:00'), endsAt: dayEnd }]);
  });

  it('keeps a last slot shorter than 15 minutes when the room stays free after midnight', () => {
    expect(
      findFreeSlots(
        [busy(on(21, '10:00'), on(21, '23:50'))],
        dayStart,
        dayEnd,
      ).pop(),
    ).toEqual({ startsAt: on(21, '23:50'), endsAt: dayEnd });
  });

  it('drops a last slot when the next booking leaves less than 15 minutes', () => {
    expect(
      findFreeSlots(
        [
          busy(on(21, '10:00'), on(21, '23:50')),
          busy(on(22, '00:04'), on(22, '01:00')),
        ],
        dayStart,
        dayEnd,
      ),
    ).toEqual([{ startsAt: dayStart, endsAt: on(21, '10:00') }]);
  });

  it('keeps a last slot that leaves exactly 15 minutes before the next booking', () => {
    expect(
      findFreeSlots(
        [
          busy(on(21, '10:00'), on(21, '23:50')),
          busy(on(22, '00:05'), on(22, '01:00')),
        ],
        on(21, '10:00'),
        dayEnd,
      ),
    ).toEqual([{ startsAt: on(21, '23:50'), endsAt: dayEnd }]);
  });

  it('keeps a short tail of today when the room is free after midnight', () => {
    const from = on(21, '23:55');

    expect(findFreeSlots([], from, dayEnd)).toEqual([
      { startsAt: from, endsAt: dayEnd },
    ]);
  });

  it('ignores a booking that starts after the window plus the minimum duration', () => {
    expect(
      findFreeSlots(
        [busy(on(22, '00:15'), on(22, '01:00'))],
        on(21, '23:40'),
        dayEnd,
      ),
    ).toEqual([{ startsAt: on(21, '23:40'), endsAt: dayEnd }]);
  });
});
