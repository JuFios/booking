import { checkBookingTime } from './booking-rules';

const now = new Date('2026-10-20T10:30:00Z');
const at = (time: string) => new Date(`2026-10-20T${time}Z`);

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
