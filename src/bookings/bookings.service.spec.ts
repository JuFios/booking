import { BookingStatus, Role } from '../generated/prisma/client';
import { type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HOUR_MS } from '../common/utils/time';
import { PrismaService } from '../prisma/prisma.service';
import { BookingsService } from './bookings.service';

const ROOM_ID = '8d3c1d52-0f6a-4b52-9c0e-1d2f3a4b5c6d';
const BOOKING_ID = '5a1f9c3e-7b2d-4e8a-a1c4-9e0b6d2f7a31';
const LOCK_TIMEOUT = "SET LOCAL lock_timeout = '5s'";
const user: AuthenticatedUser = { id: 'user-1', role: Role.member };

const start = new Date(Date.now() + 24 * HOUR_MS);
const inHours = (hours: number) => new Date(start.getTime() + hours * HOUR_MS);

interface BookingRow {
  startsAt: Date;
  endsAt: Date;
  status: BookingStatus;
}

describe('BookingsService.update', () => {
  const calls: string[] = [];
  let updateData: unknown;
  let snapshot: BookingRow;
  let current: BookingRow;
  let service: BookingsService;

  const confirmed = (): BookingRow => ({
    startsAt: start,
    endsAt: inHours(1),
    status: BookingStatus.confirmed,
  });

  beforeEach(() => {
    calls.length = 0;
    updateData = undefined;
    snapshot = confirmed();
    current = confirmed();

    const tx = {
      $executeRaw: jest.fn(
        (strings: TemplateStringsArray, ...values: unknown[]) => {
          calls.push(`${strings.join('?')}|${values.join(',')}`);
          return Promise.resolve(1);
        },
      ),
      $queryRaw: jest.fn((strings: TemplateStringsArray) => {
        if (strings.join('').includes('INSERT INTO')) {
          calls.push('insert');
          return Promise.resolve([{ id: BOOKING_ID }]);
        }
        calls.push('room check');
        return Promise.resolve([{ isActive: true, capacity: 10 }]);
      }),
      booking: {
        findUniqueOrThrow: jest.fn(() => {
          calls.push('read current');
          return Promise.resolve(current);
        }),
        updateMany: jest.fn(({ data }: { data: unknown }) => {
          calls.push('update');
          updateData = data;
          return Promise.resolve({ count: 1 });
        }),
      },
    };
    const prisma = {
      booking: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            ...snapshot,
            attendeesCount: 2,
            user: { id: user.id },
            room: { id: ROOM_ID },
          }),
        ),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: BOOKING_ID }),
      },
      $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    };
    service = new BookingsService(prisma as unknown as PrismaService);
  });

  // PATCH takes pg_advisory_xact_lock before it writes: without it parallel time
  // changes into one slot deadlock (40P01). The e2e race test cannot see
  // that, because requests through the API barely overlap in the database.
  describe('advisory lock', () => {
    it('locks the room, then reads, checks and writes when the time changes', async () => {
      await service.update(user, BOOKING_ID, {
        endsAt: inHours(2).toISOString(),
      });

      expect(calls).toEqual([
        `${LOCK_TIMEOUT}|`,
        `SELECT pg_advisory_xact_lock(hashtext(?))|${ROOM_ID}`,
        'read current',
        'room check',
        'update',
      ]);
    });

    it('does not take the lock when only the title changes', async () => {
      await service.update(user, BOOKING_ID, { title: 'New title' });

      expect(calls).toEqual(['update']);
    });
  });

  describe('state read under the lock', () => {
    it('fills the field that was not sent from the current row, not from the first read', async () => {
      current = { ...confirmed(), startsAt: inHours(3), endsAt: inHours(4) };

      await service.update(user, BOOKING_ID, {
        endsAt: inHours(5).toISOString(),
      });

      expect(updateData).toMatchObject({
        startsAt: inHours(3),
        endsAt: inHours(5),
      });
    });

    it('rejects times that are invalid against the current row, not the first read', async () => {
      current = { ...confirmed(), startsAt: inHours(3), endsAt: inHours(4) };

      // valid for the first read (start..+1h), but ends before the current start
      await expect(
        service.update(user, BOOKING_ID, { endsAt: inHours(2).toISOString() }),
      ).rejects.toThrow('startsAt must be earlier than endsAt');
      expect(calls).not.toContain('update');
    });

    it('rejects a booking that was cancelled while waiting for the lock', async () => {
      current = { ...confirmed(), status: BookingStatus.cancelled };

      await expect(
        service.update(user, BOOKING_ID, { endsAt: inHours(2).toISOString() }),
      ).rejects.toThrow('Cancelled booking cannot be changed');
      expect(calls).not.toContain('update');
    });
  });

  describe('cancelled booking', () => {
    it('is rejected before any lock, even when the new time is invalid', async () => {
      snapshot = { ...confirmed(), status: BookingStatus.cancelled };

      await expect(
        service.update(user, BOOKING_ID, {
          startsAt: new Date(Date.now() - HOUR_MS).toISOString(),
        }),
      ).rejects.toThrow('Cancelled booking cannot be changed');
      expect(calls).toEqual([]);
    });
  });
});

describe('BookingsService.create: lock wait', () => {
  it('limits the lock wait before it reads the room and inserts', async () => {
    const calls: string[] = [];
    const tx = {
      $executeRaw: jest.fn((strings: TemplateStringsArray) => {
        calls.push(strings.join('?'));
        return Promise.resolve(1);
      }),
      $queryRaw: jest.fn((strings: TemplateStringsArray) => {
        calls.push(
          strings.join('').includes('INSERT INTO') ? 'insert' : 'room check',
        );
        return Promise.resolve(
          strings.join('').includes('INSERT INTO')
            ? [{ id: BOOKING_ID }]
            : [{ isActive: true, capacity: 10 }],
        );
      }),
    };
    const prisma = {
      booking: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: BOOKING_ID }),
      },
      $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    };
    const service = new BookingsService(prisma as unknown as PrismaService);

    await service.create(user.id, {
      roomId: ROOM_ID,
      title: 'Sync',
      startsAt: inHours(1).toISOString(),
      endsAt: inHours(2).toISOString(),
      attendeesCount: 2,
    });

    expect(calls).toEqual([
      "SET LOCAL lock_timeout = '5s'",
      'room check',
      'insert',
    ]);
  });
});
