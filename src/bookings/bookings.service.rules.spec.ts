import { type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { DAY_MS, HOUR_MS } from '../common/utils/time';
import { BookingStatus, Prisma, Role } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  BookingsService,
  NOT_OWNER,
  NOTHING_TO_UPDATE,
  ROOM_ALREADY_BOOKED,
} from './bookings.service';

const ROOM_ID = '8d3c1d52-0f6a-4b52-9c0e-1d2f3a4b5c6d';
const BOOKING_ID = '5a1f9c3e-7b2d-4e8a-a1c4-9e0b6d2f7a31';

const owner: AuthenticatedUser = { id: 'owner', role: Role.member };
const stranger: AuthenticatedUser = { id: 'stranger', role: Role.member };
const admin: AuthenticatedUser = { id: 'admin', role: Role.admin };

const inHours = (hours: number) => new Date(Date.now() + hours * HOUR_MS);

interface Scenario {
  booking?: { startsAt: Date; endsAt: Date; status: BookingStatus } | null;
  room?: { isActive: boolean; capacity: number } | null;
  inserted?: { id: string }[];
  insertError?: Error;
  updateError?: Error;
  updateCount?: number;
  busy?: { startsAt: Date; endsAt: Date }[];
}

const upcoming = () => ({
  startsAt: inHours(24),
  endsAt: inHours(25),
  status: BookingStatus.confirmed,
});

const databaseError = (cause: object) =>
  new Prisma.PrismaClientKnownRequestError('database error', {
    code: 'P2010',
    clientVersion: 'test',
    meta: { driverAdapterError: { cause } },
  });

function createService(scenario: Scenario = {}) {
  const room =
    scenario.room === undefined
      ? { isActive: true, capacity: 10 }
      : scenario.room;
  const booking =
    scenario.booking === undefined ? upcoming() : scenario.booking;

  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn((strings: TemplateStringsArray) => {
      if (!strings.join('').includes('INSERT INTO')) {
        return Promise.resolve(room ? [room] : []);
      }
      return scenario.insertError
        ? Promise.reject(scenario.insertError)
        : Promise.resolve(scenario.inserted ?? [{ id: BOOKING_ID }]);
    }),
    booking: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(booking),
      updateMany: jest.fn(() =>
        scenario.updateError
          ? Promise.reject(scenario.updateError)
          : Promise.resolve({ count: scenario.updateCount ?? 1 }),
      ),
    },
  };
  const prisma = {
    booking: {
      findUnique: jest.fn().mockResolvedValue(
        booking && {
          ...booking,
          attendeesCount: 2,
          user: { id: owner.id },
          room: { id: ROOM_ID },
        },
      ),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: BOOKING_ID }),
      findMany: jest.fn().mockResolvedValue(scenario.busy ?? []),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({
        count: scenario.updateCount ?? 1,
      }),
    },
    room: { findUnique: jest.fn().mockResolvedValue(room) },
    $transaction: jest.fn((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (client: typeof tx) => unknown)(tx)
        : Promise.all(arg as unknown[]),
    ),
  };

  return {
    service: new BookingsService(prisma as unknown as PrismaService),
    prisma,
    tx,
  };
}

const createDto = (overrides: Partial<Record<string, unknown>> = {}) => ({
  roomId: ROOM_ID,
  title: 'Sync',
  startsAt: inHours(1).toISOString(),
  endsAt: inHours(2).toISOString(),
  attendeesCount: 2,
  ...overrides,
});

describe('BookingsService.create: rules', () => {
  it('creates a booking for a free slot', async () => {
    const { service, tx } = createService();

    await expect(service.create(owner.id, createDto())).resolves.toEqual({
      id: BOOKING_ID,
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('rejects an invalid time before it opens a transaction', async () => {
    const { service, prisma } = createService();

    await expect(
      service.create(
        owner.id,
        createDto({ startsAt: inHours(-2).toISOString() }),
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: 'startsAt must not be in the past',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('answers 404 for a room that does not exist', async () => {
    const { service, tx } = createService({ room: null });

    await expect(service.create(owner.id, createDto())).rejects.toMatchObject({
      status: 404,
      message: 'Room not found',
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('rejects an inactive room', async () => {
    const { service } = createService({
      room: { isActive: false, capacity: 10 },
    });

    await expect(service.create(owner.id, createDto())).rejects.toMatchObject({
      status: 400,
      message: 'Room is not active',
    });
  });

  it('rejects more attendees than the room capacity', async () => {
    const { service } = createService({
      room: { isActive: true, capacity: 4 },
    });

    await expect(
      service.create(owner.id, createDto({ attendeesCount: 5 })),
    ).rejects.toMatchObject({
      status: 400,
      message: 'attendeesCount must not exceed the room capacity (4)',
    });
  });

  it('answers 409 when the database skips the insert because the slot is taken', async () => {
    const { service } = createService({ inserted: [] });

    await expect(service.create(owner.id, createDto())).rejects.toMatchObject({
      status: 409,
      message: ROOM_ALREADY_BOOKED,
    });
  });

  it('answers 404 when the user no longer exists', async () => {
    const { service } = createService({
      insertError: databaseError({
        originalCode: '23503',
        constraint: { index: 'Booking_userId_fkey' },
      }),
    });

    await expect(service.create(owner.id, createDto())).rejects.toMatchObject({
      status: 404,
      message: 'User not found',
    });
  });

  it('passes an unknown database error on', async () => {
    const failure = databaseError({ originalCode: '42P01' });
    const { service } = createService({ insertError: failure });

    await expect(service.create(owner.id, createDto())).rejects.toBe(failure);
  });
});

describe('BookingsService: access to a booking', () => {
  it.each([
    [
      'findOne',
      (s: BookingsService, u: AuthenticatedUser) => s.findOne(u, BOOKING_ID),
    ],
    [
      'update',
      (s: BookingsService, u: AuthenticatedUser) =>
        s.update(u, BOOKING_ID, { title: 'New' }),
    ],
    [
      'cancel',
      (s: BookingsService, u: AuthenticatedUser) => s.cancel(u, BOOKING_ID),
    ],
  ])('%s: answers 404 for a booking that does not exist', async (_, call) => {
    const { service } = createService({ booking: null });

    await expect(call(service, owner)).rejects.toMatchObject({
      status: 404,
      message: 'Booking not found',
    });
  });

  it.each([
    [
      'findOne',
      (s: BookingsService, u: AuthenticatedUser) => s.findOne(u, BOOKING_ID),
    ],
    [
      'update',
      (s: BookingsService, u: AuthenticatedUser) =>
        s.update(u, BOOKING_ID, { title: 'New' }),
    ],
    [
      'cancel',
      (s: BookingsService, u: AuthenticatedUser) => s.cancel(u, BOOKING_ID),
    ],
  ])('%s: answers 403 to a member who is not the owner', async (_, call) => {
    const { service, prisma, tx } = createService();

    await expect(call(service, stranger)).rejects.toMatchObject({
      status: 403,
      message: NOT_OWNER,
    });
    expect(prisma.booking.updateMany).not.toHaveBeenCalled();
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    [
      'findOne',
      (s: BookingsService, u: AuthenticatedUser) => s.findOne(u, BOOKING_ID),
    ],
    [
      'update',
      (s: BookingsService, u: AuthenticatedUser) =>
        s.update(u, BOOKING_ID, { title: 'New' }),
    ],
    [
      'cancel',
      (s: BookingsService, u: AuthenticatedUser) => s.cancel(u, BOOKING_ID),
    ],
  ])('%s: lets the owner and an admin in', async (_, call) => {
    const { service } = createService();

    await expect(call(service, owner)).resolves.toBeDefined();
    await expect(call(service, admin)).resolves.toBeDefined();
  });
});

describe('BookingsService.findAll: who sees what', () => {
  const query = { page: 1, limit: 20 };

  it('limits a member to own bookings', async () => {
    const { service, prisma } = createService();

    await service.findAll(owner, query);

    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: owner.id }) as unknown,
      }),
    );
  });

  it('shows an admin the bookings of all users', async () => {
    const { service, prisma } = createService();

    await service.findAll(admin, query);

    const [args] = prisma.booking.findMany.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(args.where).not.toHaveProperty('userId');
  });

  it('rejects a period whose start is not before its end', async () => {
    const { service } = createService();
    const moment = inHours(5).toISOString();

    await expect(
      service.findAll(admin, { ...query, from: moment, to: moment }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'from must be earlier than to',
    });
  });
});

describe('BookingsService.update: rules', () => {
  it('rejects a request with nothing to change', async () => {
    const { service, prisma } = createService();

    await expect(service.update(owner, BOOKING_ID, {})).rejects.toMatchObject({
      status: 400,
      message: NOTHING_TO_UPDATE,
    });
    expect(prisma.booking.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a change of a booking that has ended', async () => {
    const { service, prisma } = createService({
      booking: {
        startsAt: inHours(-3),
        endsAt: inHours(-2),
        status: BookingStatus.confirmed,
      },
    });

    await expect(
      service.update(owner, BOOKING_ID, { title: 'New' }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Ended booking cannot be changed',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a new time that breaks the duration rule', async () => {
    const { service } = createService();

    await expect(
      service.update(owner, BOOKING_ID, {
        endsAt: inHours(24 + 9).toISOString(),
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Booking must not last longer than 8 hours',
    });
  });

  it('answers 409 when the new time overlaps another booking', async () => {
    const { service } = createService({
      updateError: databaseError({ originalCode: '23P01' }),
    });

    await expect(
      service.update(owner, BOOKING_ID, {
        endsAt: inHours(26).toISOString(),
      }),
    ).rejects.toMatchObject({ status: 409, message: ROOM_ALREADY_BOOKED });
  });

  it('rejects a new time when the room was deactivated', async () => {
    const { service, tx } = createService({
      room: { isActive: false, capacity: 10 },
    });

    await expect(
      service.update(owner, BOOKING_ID, {
        endsAt: inHours(26).toISOString(),
      }),
    ).rejects.toMatchObject({ status: 400, message: 'Room is not active' });
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
  });

  it('changes the title of a booking whose room is inactive', async () => {
    const { service, tx } = createService({
      room: { isActive: false, capacity: 10 },
    });

    await service.update(owner, BOOKING_ID, { title: 'New' });

    expect(tx.booking.updateMany).toHaveBeenCalledTimes(1);
  });

  it('rejects a booking cancelled between the read and the write', async () => {
    const { service } = createService({ updateCount: 0 });

    await expect(
      service.update(owner, BOOKING_ID, { title: 'New' }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Cancelled booking cannot be changed',
    });
  });
});

describe('BookingsService.cancel: rules', () => {
  it('cancels a confirmed booking', async () => {
    const { service, prisma } = createService();

    await service.cancel(owner, BOOKING_ID);

    expect(prisma.booking.updateMany).toHaveBeenCalledWith({
      where: { id: BOOKING_ID, status: BookingStatus.confirmed },
      data: { status: BookingStatus.cancelled },
    });
  });

  it('cancels a meeting that is going on', async () => {
    const { service } = createService({
      booking: {
        startsAt: inHours(-1),
        endsAt: inHours(1),
        status: BookingStatus.confirmed,
      },
    });

    await expect(service.cancel(owner, BOOKING_ID)).resolves.toBeDefined();
  });

  it('rejects the cancellation of an ended booking', async () => {
    const { service, prisma } = createService({
      booking: {
        startsAt: inHours(-3),
        endsAt: inHours(-2),
        status: BookingStatus.confirmed,
      },
    });

    await expect(service.cancel(owner, BOOKING_ID)).rejects.toMatchObject({
      status: 400,
      message: 'Ended booking cannot be cancelled',
    });
    expect(prisma.booking.updateMany).not.toHaveBeenCalled();
  });

  it('rejects the cancellation of a booking that is already cancelled', async () => {
    const { service } = createService({ updateCount: 0 });

    await expect(service.cancel(owner, BOOKING_ID)).rejects.toMatchObject({
      status: 400,
      message: 'Booking is already cancelled',
    });
  });
});

describe('BookingsService.getAvailability', () => {
  const tomorrow = new Date(Date.now() + DAY_MS).toISOString().slice(0, 10);

  it('answers 404 for a room that does not exist', async () => {
    const { service } = createService({ room: null });

    await expect(
      service.getAvailability(ROOM_ID, tomorrow),
    ).rejects.toMatchObject({ status: 404, message: 'Room not found' });
  });

  it('has no free slots in an inactive room and does not read bookings', async () => {
    const { service, prisma } = createService({
      room: { isActive: false, capacity: 10 },
    });

    await expect(service.getAvailability(ROOM_ID, tomorrow)).resolves.toEqual({
      roomId: ROOM_ID,
      date: tomorrow,
      slots: [],
    });
    expect(prisma.booking.findMany).not.toHaveBeenCalled();
  });

  it('has no free slots on a day in the past and does not read bookings', async () => {
    const { service, prisma } = createService();

    const result = await service.getAvailability(ROOM_ID, '2020-01-01');

    expect(result.slots).toEqual([]);
    expect(prisma.booking.findMany).not.toHaveBeenCalled();
  });

  it('is free for the whole day when the room has no bookings', async () => {
    const { service } = createService();

    const { slots } = await service.getAvailability(ROOM_ID, tomorrow);

    expect(slots).toEqual([
      {
        startsAt: new Date(`${tomorrow}T00:00:00.000Z`),
        endsAt: new Date(
          new Date(`${tomorrow}T00:00:00.000Z`).getTime() + DAY_MS,
        ),
      },
    ]);
  });

  it('leaves out the time taken by a confirmed booking', async () => {
    const day = new Date(`${tomorrow}T00:00:00.000Z`).getTime();
    const busy = [
      {
        startsAt: new Date(day + 10 * HOUR_MS),
        endsAt: new Date(day + 11 * HOUR_MS),
      },
    ];
    const { service } = createService({ busy });

    const { slots } = await service.getAvailability(ROOM_ID, tomorrow);

    expect(slots).toEqual([
      { startsAt: new Date(day), endsAt: new Date(day + 10 * HOUR_MS) },
      {
        startsAt: new Date(day + 11 * HOUR_MS),
        endsAt: new Date(day + DAY_MS),
      },
    ]);
  });
});
