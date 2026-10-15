import { type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HOUR_MS } from '../common/utils/time';
import { Role } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BookingsService } from './bookings.service';

const ROOM_ID = '8d3c1d52-0f6a-4b52-9c0e-1d2f3a4b5c6d';
const BOOKING_ID = '5a1f9c3e-7b2d-4e8a-a1c4-9e0b6d2f7a31';
const user: AuthenticatedUser = { id: 'user-1', role: Role.member };

// PATCH takes pg_advisory_xact_lock before it writes: without it parallel time
// changes into one slot deadlock (40P01 → 500). The e2e race test cannot see
// that, because requests through the API barely overlap in the database.
describe('BookingsService.update: advisory lock', () => {
  const start = new Date(Date.now() + 24 * HOUR_MS);
  const calls: string[] = [];
  let service: BookingsService;

  beforeEach(() => {
    calls.length = 0;
    const tx = {
      $executeRaw: jest.fn(
        (strings: TemplateStringsArray, ...values: unknown[]) => {
          calls.push(`${strings.join('?')}|${values.join(',')}`);
          return Promise.resolve(1);
        },
      ),
      $queryRaw: jest.fn(() => {
        calls.push('room check');
        return Promise.resolve([{ isActive: true, capacity: 10 }]);
      }),
      booking: {
        updateMany: jest.fn(() => {
          calls.push('update');
          return Promise.resolve({ count: 1 });
        }),
      },
    };
    const prisma = {
      booking: {
        findUnique: jest.fn().mockResolvedValue({
          startsAt: start,
          endsAt: new Date(start.getTime() + HOUR_MS),
          attendeesCount: 2,
          user: { id: user.id },
          room: { id: ROOM_ID },
        }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: BOOKING_ID }),
      },
      $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    };
    service = new BookingsService(prisma as unknown as PrismaService);
  });

  it('locks the room before checking it and writing when the time changes', async () => {
    await service.update(user, BOOKING_ID, {
      endsAt: new Date(start.getTime() + 2 * HOUR_MS).toISOString(),
    });

    expect(calls).toEqual([
      `SELECT pg_advisory_xact_lock(hashtext(?))|${ROOM_ID}`,
      'room check',
      'update',
    ]);
  });

  it('does not take the lock when only the title changes', async () => {
    await service.update(user, BOOKING_ID, { title: 'New title' });

    expect(calls).toEqual(['update']);
  });
});
