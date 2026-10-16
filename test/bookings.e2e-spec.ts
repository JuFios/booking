import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { TokensResponseDto } from '../src/auth/dto/tokens-response.dto';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '../src/common/utils/time';
import { PrismaService } from '../src/prisma/prisma.service';

interface BookingBody {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: string;
  attendeesCount: number;
  room: { id: string; name: string };
  user: { id: string; name: string; email: string };
}

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string;
  details?: string[];
}

interface Slot {
  startsAt: string;
  endsAt: string;
}

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

const dayAt = (daysAhead: number, hour = 10, minute = 0): Date => {
  const date = new Date(Date.now() + daysAhead * DAY_MS);
  date.setUTCHours(hour, minute, 0, 0);
  return date;
};

const slot = (daysAhead: number, hour = 10, minutes = 60): Slot => {
  const startsAt = dayAt(daysAhead, hour);
  return {
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + minutes * MINUTE_MS).toISOString(),
  };
};

const dateOf = (daysAhead: number) =>
  dayAt(daysAhead).toISOString().slice(0, 10);

describe('Bookings (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: { id: string; token: string };
  let other: { id: string; token: string };
  let admin: { id: string; token: string };
  let roomId: string;

  const run = Date.now();
  const emailFor = (name: string) => `${name}-${run}@e2e.test`;
  const password = 'secret-pass-1';
  const roomIds: string[] = [];

  const call = (
    method: 'get' | 'post' | 'patch',
    path: string,
    token?: string,
  ) => {
    const req = request(app.getHttpServer())[method](path);
    return token ? req.auth(token, { type: 'bearer' }) : req;
  };

  const login = async (email: string): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return (response.body as TokensResponseDto).accessToken;
  };

  const registerMember = async (name: string) => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: emailFor(name), password, name })
      .expect(201);
    return {
      id: (response.body as { id: string }).id,
      token: await login(emailFor(name)),
    };
  };

  const createRoom = async (
    data: { capacity?: number; isActive?: boolean } = {},
  ) => {
    const room = await prisma.room.create({
      data: {
        name: `Bookings room ${run} ${roomIds.length}`,
        capacity: data.capacity ?? 5,
        floor: 1,
        isActive: data.isActive,
      },
    });
    roomIds.push(room.id);
    return room.id;
  };

  const book = (
    token: string,
    time: Slot,
    extra: Record<string, unknown> = {},
    room = roomId,
  ) =>
    call('post', '/bookings', token).send({
      roomId: room,
      title: 'Sync',
      attendeesCount: 2,
      ...time,
      ...extra,
    });

  const bookOk = async (token: string, time: Slot, room = roomId) => {
    const response = await book(token, time, {}, room).expect(201);
    return response.body as BookingBody;
  };

  const freeSlots = async (date: string, room = roomId) => {
    const response = await call(
      'get',
      `/rooms/${room}/availability?date=${date}`,
      owner.token,
    ).expect(200);
    return (response.body as { slots: Slot[] }).slots;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    owner = await registerMember('owner');
    other = await registerMember('other');
    const adminUser = await prisma.user.create({
      data: {
        email: emailFor('admin'),
        name: 'admin',
        role: 'admin',
        passwordHash: await argon2.hash(password),
      },
    });
    admin = { id: adminUser.id, token: await login(emailFor('admin')) };
  });

  beforeEach(async () => {
    roomId = await createRoom();
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.booking.deleteMany({ where: { roomId: { in: roomIds } } });
      await prisma.room.deleteMany({ where: { id: { in: roomIds } } });
      await prisma.user.deleteMany({
        where: { email: { endsWith: `-${run}@e2e.test` } },
      });
    }
    await app?.close();
  });

  describe('full cycle', () => {
    it('creates, reads, lists, changes and cancels a booking, and frees the slot', async () => {
      const day = 5;
      const time = slot(day, 10);
      const wholeDay = [
        {
          startsAt: `${dateOf(day)}T00:00:00.000Z`,
          endsAt: new Date(
            new Date(`${dateOf(day)}T00:00:00.000Z`).getTime() + DAY_MS,
          ).toISOString(),
        },
      ];
      expect(await freeSlots(dateOf(day))).toEqual(wholeDay);

      const created = await book(owner.token, time).expect(201);
      expect(created.body).toEqual({
        id: expect.any(String) as string,
        title: 'Sync',
        ...time,
        status: 'confirmed',
        attendeesCount: 2,
        room: { id: roomId, name: expect.any(String) as string },
        user: {
          id: owner.id,
          name: 'owner',
          email: emailFor('owner'),
        },
        createdAt: expect.any(String) as string,
        updatedAt: expect.any(String) as string,
      });
      const id = (created.body as BookingBody).id;

      const read = await call('get', `/bookings/${id}`, owner.token).expect(
        200,
      );
      expect(read.body).toEqual(created.body);

      const list = await call(
        'get',
        `/bookings?roomId=${roomId}`,
        owner.token,
      ).expect(200);
      expect(list.body).toEqual({
        items: [created.body],
        total: 1,
        page: 1,
        limit: 20,
      });

      expect(await freeSlots(dateOf(day))).toEqual([
        { startsAt: wholeDay[0].startsAt, endsAt: time.startsAt },
        { startsAt: time.endsAt, endsAt: wholeDay[0].endsAt },
      ]);

      const renamed = await call('patch', `/bookings/${id}`, owner.token)
        .send({ title: 'Planning' })
        .expect(200);
      expect((renamed.body as BookingBody).title).toBe('Planning');

      const moved = slot(day, 14, 90);
      const rescheduled = await call('patch', `/bookings/${id}`, owner.token)
        .send(moved)
        .expect(200);
      expect(rescheduled.body).toMatchObject({
        id,
        title: 'Planning',
        ...moved,
      });

      const cancelled = await call(
        'post',
        `/bookings/${id}/cancel`,
        owner.token,
      ).expect(200);
      expect((cancelled.body as BookingBody).status).toBe('cancelled');
      expect(await freeSlots(dateOf(day))).toEqual(wholeDay);

      const again = await book(other.token, moved).expect(201);
      expect((again.body as BookingBody).user.id).toBe(other.id);
    });

    it('does not let a cancelled booking be changed or cancelled again', async () => {
      const { id } = await bookOk(owner.token, slot(6));
      await call('post', `/bookings/${id}/cancel`, owner.token).expect(200);

      const change = await call('patch', `/bookings/${id}`, owner.token)
        .send({ title: 'Late' })
        .expect(400);
      expect((change.body as ErrorBody).message).toBe(
        'Cancelled booking cannot be changed',
      );
      const cancelAgain = await call(
        'post',
        `/bookings/${id}/cancel`,
        owner.token,
      ).expect(400);
      expect((cancelAgain.body as ErrorBody).message).toBe(
        'Booking is already cancelled',
      );
    });
  });

  describe('authentication', () => {
    it.each([
      ['POST /bookings', 'post', '/bookings'],
      ['GET /bookings', 'get', '/bookings'],
      ['GET /bookings/:id', 'get', `/bookings/${UNKNOWN_ID}`],
      ['PATCH /bookings/:id', 'patch', `/bookings/${UNKNOWN_ID}`],
      ['POST /bookings/:id/cancel', 'post', `/bookings/${UNKNOWN_ID}/cancel`],
      [
        'GET /rooms/:id/availability',
        'get',
        `/rooms/${UNKNOWN_ID}/availability?date=2030-01-01`,
      ],
    ] as const)('%s returns 401 without a token', async (_, method, path) => {
      await call(method, path).send({}).expect(401);
    });

    it('returns 401 for a token that is not valid', async () => {
      await call('get', '/bookings', 'not-a-token').expect(401);
    });
  });

  describe('access to bookings of other users', () => {
    let id: string;

    beforeEach(async () => {
      id = (await bookOk(owner.token, slot(7))).id;
    });

    it('returns 403 to a member on read, change and cancel', async () => {
      await call('get', `/bookings/${id}`, other.token).expect(403);
      await call('patch', `/bookings/${id}`, other.token)
        .send({ title: 'Mine now' })
        .expect(403);
      await call('post', `/bookings/${id}/cancel`, other.token).expect(403);

      const stored = await prisma.booking.findUniqueOrThrow({ where: { id } });
      expect(stored).toMatchObject({ title: 'Sync', status: 'confirmed' });
    });

    it('shows a member only own bookings and an admin all of them', async () => {
      await bookOk(other.token, slot(7, 12));
      const ids = async (token: string) =>
        (
          (await call('get', `/bookings?roomId=${roomId}`, token).expect(200))
            .body as { items: BookingBody[] }
        ).items.map((item) => item.user.id);

      expect(await ids(owner.token)).toEqual([owner.id]);
      expect(await ids(other.token)).toEqual([other.id]);
      expect((await ids(admin.token)).sort()).toEqual(
        [owner.id, other.id].sort(),
      );
    });

    it('lets an admin read, change and cancel a booking of a member', async () => {
      await call('get', `/bookings/${id}`, admin.token).expect(200);
      await call('patch', `/bookings/${id}`, admin.token)
        .send({ title: 'By admin' })
        .expect(200);
      const cancelled = await call(
        'post',
        `/bookings/${id}/cancel`,
        admin.token,
      ).expect(200);
      expect((cancelled.body as BookingBody).status).toBe('cancelled');
    });
  });

  describe('overlapping bookings', () => {
    it('returns 409 for the same slot and for a partial overlap', async () => {
      await bookOk(owner.token, slot(8, 10, 60));

      const same = await book(other.token, slot(8, 10, 60)).expect(409);
      expect((same.body as ErrorBody).message).toBe(
        'Room is already booked for this time',
      );
      await book(other.token, slot(8, 10, 30)).expect(409);
      await book(other.token, {
        startsAt: dayAt(8, 10, 30).toISOString(),
        endsAt: dayAt(8, 11, 30).toISOString(),
      }).expect(409);
      await book(other.token, slot(8, 9, 120)).expect(409);
    });

    it('allows bookings that touch each other', async () => {
      await bookOk(owner.token, slot(8, 10, 60));
      await bookOk(other.token, slot(8, 11, 60));
      await bookOk(other.token, slot(8, 9, 60));
    });

    it('allows the same slot in another room', async () => {
      await bookOk(owner.token, slot(8, 10));
      await bookOk(other.token, slot(8, 10), await createRoom());
    });

    it('returns 409 when a change moves a booking into a taken slot', async () => {
      await bookOk(owner.token, slot(9, 10));
      const { id } = await bookOk(other.token, slot(9, 12));

      await call('patch', `/bookings/${id}`, other.token)
        .send(slot(9, 10, 30))
        .expect(409);

      const stored = await prisma.booking.findUniqueOrThrow({ where: { id } });
      expect(stored.startsAt).toEqual(dayAt(9, 12));
    });

    it('lets a booking be extended into free time next to it', async () => {
      const { id } = await bookOk(owner.token, slot(9, 10));

      await call('patch', `/bookings/${id}`, owner.token)
        .send({ endsAt: dayAt(9, 12).toISOString() })
        .expect(200);
    });
  });

  describe('booking rules', () => {
    const rejects = [
      [
        'starts in the past',
        () => slot(-1),
        'startsAt must not be in the past',
      ],
      [
        'lasts less than 15 minutes',
        () => slot(10, 10, 14),
        'Booking must last at least 15 minutes',
      ],
      [
        'lasts more than 8 hours',
        () => slot(10, 8, 9 * 60),
        'Booking must not last longer than 8 hours',
      ],
      [
        'ends before it starts',
        () => ({ startsAt: slot(10).endsAt, endsAt: slot(10).startsAt }),
        'startsAt must be earlier than endsAt',
      ],
      [
        'starts more than 365 days ahead',
        () => slot(366),
        'startsAt must be at most 365 days ahead',
      ],
    ] as const;

    it.each(rejects)(
      'returns 400 when a booking %s',
      async (_, time, message) => {
        const response = await book(owner.token, time()).expect(400);

        expect((response.body as ErrorBody).message).toBe(message);
      },
    );

    it('accepts the longest booking of 8 hours and the shortest of 15 minutes', async () => {
      await bookOk(owner.token, slot(10, 8, 8 * 60));
      await bookOk(owner.token, slot(10, 17, 15));
    });

    it('returns 400 when there are more attendees than seats', async () => {
      const response = await book(owner.token, slot(10), {
        attendeesCount: 6,
      }).expect(400);

      expect((response.body as ErrorBody).message).toBe(
        'attendeesCount must not exceed the room capacity (5)',
      );
      await book(owner.token, slot(10), { attendeesCount: 5 }).expect(201);
    });

    it('returns 400 for an inactive room', async () => {
      const inactive = await createRoom({ isActive: false });

      const response = await book(owner.token, slot(10), {}, inactive).expect(
        400,
      );

      expect((response.body as ErrorBody).message).toBe('Room is not active');
    });

    it('returns 404 for a room that does not exist', async () => {
      await book(owner.token, slot(10), {}, UNKNOWN_ID).expect(404);
    });

    it('does not let an ended booking be changed or cancelled', async () => {
      const past = await prisma.booking.create({
        data: {
          title: 'Past',
          startsAt: new Date(Date.now() - 3 * HOUR_MS),
          endsAt: new Date(Date.now() - 2 * HOUR_MS),
          attendeesCount: 2,
          roomId,
          userId: owner.id,
        },
      });

      await call('patch', `/bookings/${past.id}`, owner.token)
        .send({ title: 'Edit' })
        .expect(400);
      await call('post', `/bookings/${past.id}/cancel`, owner.token).expect(
        400,
      );
    });

    it('lets a meeting that is going on be extended and cancelled', async () => {
      const going = await prisma.booking.create({
        data: {
          title: 'Going',
          startsAt: new Date(Date.now() - HOUR_MS),
          endsAt: new Date(Date.now() + HOUR_MS),
          attendeesCount: 2,
          roomId,
          userId: owner.id,
        },
      });

      await call('patch', `/bookings/${going.id}`, owner.token)
        .send({ endsAt: new Date(Date.now() + 2 * HOUR_MS).toISOString() })
        .expect(200);
      await call('post', `/bookings/${going.id}/cancel`, owner.token).expect(
        200,
      );
    });

    it('returns 400 when a change breaks a rule', async () => {
      const { id } = await bookOk(owner.token, slot(10));

      await call('patch', `/bookings/${id}`, owner.token)
        .send({ startsAt: slot(10, 12).startsAt })
        .expect(400);
      await call('patch', `/bookings/${id}`, owner.token)
        .send({ endsAt: dayAt(10, 20).toISOString() })
        .expect(400);
      await call('patch', `/bookings/${id}`, owner.token)
        .send({ startsAt: slot(-1).startsAt, endsAt: slot(-1).endsAt })
        .expect(400);
    });
  });

  describe('invalid input never gives 500', () => {
    const valid = () => ({
      roomId,
      title: 'Sync',
      attendeesCount: 2,
      ...slot(11),
    });

    it.each([
      ['a missing title', { title: undefined }],
      ['an empty title', { title: '' }],
      ['a title that is not a string', { title: 5 }],
      ['an extra field', { status: 'cancelled' }],
      ['a room id that is not a uuid', { roomId: 'room-1' }],
      ['a missing room id', { roomId: undefined }],
      ['a start that is not a date', { startsAt: 'tomorrow' }],
      ['a start without the UTC mark', { startsAt: '2030-01-01T10:00:00' }],
      ['a start with an offset', { startsAt: '2030-01-01T10:00:00+02:00' }],
      ['an impossible date', { startsAt: '2030-02-31T10:00:00Z' }],
      ['a negative year', { startsAt: '-000001-01-01T10:00:00Z' }],
      ['zero attendees', { attendeesCount: 0 }],
      ['a fractional attendees count', { attendeesCount: 1.5 }],
      ['attendees as a string', { attendeesCount: 'two' }],
      ['a huge attendees count', { attendeesCount: 1e12 }],
    ])('POST /bookings returns 400 for %s', async (_, override) => {
      const response = await call('post', '/bookings', owner.token)
        .send({ ...valid(), ...override })
        .expect(400);

      expect((response.body as ErrorBody).statusCode).toBe(400);
    });

    it.each([
      ['an array', [valid()]],
      ['an empty object', {}],
      ['a string', '"text"'],
    ])('POST /bookings returns 400 for a body that is %s', async (_, body) => {
      await call('post', '/bookings', owner.token)
        .set('Content-Type', 'application/json')
        .send(body)
        .expect(400);
    });

    it('returns 400 for a body that is not JSON', async () => {
      await call('post', '/bookings', owner.token)
        .set('Content-Type', 'application/json')
        .send('{"roomId": ')
        .expect(400);
    });

    it.each([
      ['an empty body', {}],
      ['an extra field', { title: 'x', roomId: UNKNOWN_ID }],
      ['a start that is not a date', { startsAt: 'soon' }],
      ['an empty title', { title: '' }],
    ])('PATCH /bookings/:id returns 400 for %s', async (_, body) => {
      const { id } = await bookOk(owner.token, slot(11));

      await call('patch', `/bookings/${id}`, owner.token)
        .send(body)
        .expect(400);
    });

    it.each([
      ['GET /bookings/:id', 'get', ''],
      ['PATCH /bookings/:id', 'patch', ''],
      ['POST /bookings/:id/cancel', 'post', '/cancel'],
    ] as const)(
      '%s returns 400 for an id that is not a uuid and 404 for an unknown one',
      async (_, method, suffix) => {
        await call(method, `/bookings/123${suffix}`, owner.token)
          .send({ title: 'x' })
          .expect(400);
        await call(method, `/bookings/${UNKNOWN_ID}${suffix}`, owner.token)
          .send({ title: 'x' })
          .expect(404);
      },
    );

    it.each([
      ['page 0', 'page=0'],
      ['page that is not a number', 'page=first'],
      ['limit above 100', 'limit=101'],
      ['limit 0', 'limit=0'],
      ['a status that does not exist', 'status=done'],
      ['a room id that is not a uuid', 'roomId=1'],
      ['a period that is not a date', 'from=yesterday'],
      ['a period without the UTC mark', 'from=2030-01-01T10:00:00'],
      [
        'a period that starts after it ends',
        `from=${slot(11).endsAt}&to=${slot(11).startsAt}`,
      ],
      ['an unknown filter', 'userId=1'],
    ])('GET /bookings returns 400 for %s', async (_, query) => {
      await call('get', `/bookings?${query}`, owner.token).expect(400);
    });

    it.each([
      ['no date', ''],
      ['a date in the wrong format', '?date=01.01.2030'],
      ['a date that does not exist', '?date=2030-02-31'],
    ])('GET /rooms/:id/availability returns 400 for %s', async (_, query) => {
      await call(
        'get',
        `/rooms/${roomId}/availability${query}`,
        owner.token,
      ).expect(400);
    });

    it('GET /rooms/:id/availability returns 400 for an id that is not a uuid and 404 for an unknown room', async () => {
      await call(
        'get',
        '/rooms/1/availability?date=2030-01-01',
        owner.token,
      ).expect(400);
      await call(
        'get',
        `/rooms/${UNKNOWN_ID}/availability?date=2030-01-01`,
        owner.token,
      ).expect(404);
    });
  });

  describe('list filters and pagination', () => {
    it('filters by room, status and period, and pages the result', async () => {
      const first = await bookOk(owner.token, slot(12, 9));
      const second = await bookOk(owner.token, slot(12, 11));
      const third = await bookOk(owner.token, slot(13, 9));
      await call('post', `/bookings/${second.id}/cancel`, owner.token).expect(
        200,
      );

      const ids = async (query: string) =>
        (
          (
            await call(
              'get',
              `/bookings?roomId=${roomId}&${query}`,
              owner.token,
            ).expect(200)
          ).body as { items: BookingBody[] }
        ).items.map((item) => item.id);

      expect(await ids('')).toEqual([first.id, second.id, third.id]);
      expect(await ids('status=cancelled')).toEqual([second.id]);
      expect(await ids('status=confirmed')).toEqual([first.id, third.id]);
      expect(
        await ids(
          `from=${dayAt(13, 0).toISOString()}&to=${dayAt(14, 0).toISOString()}`,
        ),
      ).toEqual([third.id]);
      expect(await ids(`to=${dayAt(12, 10).toISOString()}`)).toEqual([
        first.id,
      ]);

      const page = await call(
        'get',
        `/bookings?roomId=${roomId}&limit=2&page=2`,
        owner.token,
      ).expect(200);
      expect(page.body).toMatchObject({
        items: [{ id: third.id }],
        total: 3,
        page: 2,
        limit: 2,
      });
    });

    it('counts a booking that is going on in the period that starts inside it', async () => {
      const going = await prisma.booking.create({
        data: {
          title: 'Going',
          startsAt: new Date(Date.now() - HOUR_MS),
          endsAt: new Date(Date.now() + HOUR_MS),
          attendeesCount: 2,
          roomId,
          userId: owner.id,
        },
      });

      const response = await call(
        'get',
        `/bookings?roomId=${roomId}&from=${new Date().toISOString()}`,
        owner.token,
      ).expect(200);

      expect((response.body as { items: BookingBody[] }).items[0].id).toBe(
        going.id,
      );
    });
  });

  describe('availability', () => {
    it('has no free slots in an inactive room or on a day in the past', async () => {
      const inactive = await createRoom({ isActive: false });

      expect(await freeSlots(dateOf(14), inactive)).toEqual([]);
      expect(await freeSlots('2020-01-01')).toEqual([]);
    });

    it('drops a gap shorter than 15 minutes between two bookings', async () => {
      await bookOk(owner.token, slot(15, 10, 60));
      await bookOk(owner.token, {
        startsAt: dayAt(15, 11, 10).toISOString(),
        endsAt: dayAt(15, 12, 0).toISOString(),
      });

      const slots = await freeSlots(dateOf(15));

      expect(slots).toHaveLength(2);
      expect(slots[0].endsAt).toBe(dayAt(15, 10).toISOString());
      expect(slots[1].startsAt).toBe(dayAt(15, 12).toISOString());
    });
  });
});
