import {
  checkBookingTime,
  hasEnded,
  MAX_BOOKING_ADVANCE_MS,
} from './booking-rules';

const now = new Date('2026-10-20T10:30:00Z');
const at = (time: string) => new Date(`2026-10-20T${time}Z`);
const later = (date: Date, ms: number) => new Date(date.getTime() + ms);
const HOUR_MS = 60 * 60 * 1000;

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
      const startsAt = later(now, MAX_BOOKING_ADVANCE_MS + 60 * 1000);
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
