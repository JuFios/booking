import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { TokensResponseDto } from '../src/auth/dto/tokens-response.dto';
import { useRequestLogging } from '../src/common/logging/request-logging';
import { DAY_MS, MINUTE_MS } from '../src/common/utils/time';
import { PrismaService } from '../src/prisma/prisma.service';

const PARALLEL_REQUESTS = 20;

// 10:00 UTC a given number of days from today
const daysAhead = (days: number): Date => {
  const date = new Date(Date.now() + days * DAY_MS);
  date.setUTCHours(10, 0, 0, 0);
  return date;
};

const countStatuses = (responses: { status: number }[]) => {
  const counts: Record<number, number> = {};
  for (const { status } of responses) {
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
};

describe('Booking race (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let accessToken: string;
  let roomId: string;

  const run = randomUUID();
  const email = `race-${run}@e2e.test`;
  const password = 'secret-pass-1';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    useRequestLogging(app);
    await app.init();
    prisma = app.get(PrismaService);

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, name: 'Race' })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    accessToken = (login.body as TokensResponseDto).accessToken;

    // A room of its own, so other tests and seed data cannot take the slot
    const room = await prisma.room.create({
      data: { name: `Race room ${run}`, capacity: 10, floor: 1 },
    });
    roomId = room.id;

    // Opens pool connections in advance: on a cold pool the requests wait for
    // a connection one by one and never overlap, which hides the race
    await Promise.all(
      Array.from({ length: 10 }, () => prisma.$queryRaw`SELECT 1`),
    );
  });

  afterAll(async () => {
    // beforeAll may fail before the app or the room exists. An undefined roomId
    // would make deleteMany match every booking in the database
    if (prisma) {
      if (roomId) {
        await prisma.booking.deleteMany({ where: { roomId } });
        await prisma.room.delete({ where: { id: roomId } });
      }
      await prisma.user.deleteMany({ where: { email } });
    }
    await app?.close();
  });

  it(`gives exactly one booking for ${PARALLEL_REQUESTS} parallel requests on one slot`, async () => {
    const startsAt = daysAhead(1);
    const endsAt = new Date(startsAt.getTime() + 60 * MINUTE_MS);

    const responses = await Promise.all(
      Array.from({ length: PARALLEL_REQUESTS }, (_, i) =>
        request(app.getHttpServer())
          .post('/bookings')
          .auth(accessToken, { type: 'bearer' })
          .send({
            roomId,
            title: `Race ${i + 1}`,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            attendeesCount: 2,
          }),
      ),
    );

    const bookingsInDb = await prisma.booking.count({ where: { roomId } });

    expect({ statusCounts: countStatuses(responses), bookingsInDb }).toEqual({
      statusCounts: { 201: 1, 409: PARALLEL_REQUESTS - 1 },
      bookingsInDb: 1,
    });
  });

  it(`moves exactly one booking for ${PARALLEL_REQUESTS} parallel time changes into one slot`, async () => {
    // Bookings in separate 15-minute slots, 30 minutes apart, two days ahead
    const firstStart = daysAhead(2);
    const ids = await Promise.all(
      Array.from({ length: PARALLEL_REQUESTS }, async (_, i) => {
        const startsAt = new Date(firstStart.getTime() + i * 30 * MINUTE_MS);
        const response = await request(app.getHttpServer())
          .post('/bookings')
          .auth(accessToken, { type: 'bearer' })
          .send({
            roomId,
            title: `Move ${i + 1}`,
            startsAt: startsAt.toISOString(),
            endsAt: new Date(startsAt.getTime() + 15 * MINUTE_MS).toISOString(),
            attendeesCount: 2,
          })
          .expect(201);
        return (response.body as { id: string }).id;
      }),
    );

    // Every booking is moved to the same free slot three days ahead
    const startsAt = daysAhead(3);
    const endsAt = new Date(startsAt.getTime() + 60 * MINUTE_MS);
    const responses = await Promise.all(
      ids.map((id) =>
        request(app.getHttpServer())
          .patch(`/bookings/${id}`)
          .auth(accessToken, { type: 'bearer' })
          .send({
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
          }),
      ),
    );

    const bookingsInSlot = await prisma.booking.count({
      where: { roomId, startsAt, endsAt },
    });

    expect({ statusCounts: countStatuses(responses), bookingsInSlot }).toEqual({
      statusCounts: { 200: 1, 409: PARALLEL_REQUESTS - 1 },
      bookingsInSlot: 1,
    });
  });
});
