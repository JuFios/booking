import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { TokensResponseDto } from '../src/auth/dto/tokens-response.dto';
import { PrismaService } from '../src/prisma/prisma.service';

const PARALLEL_REQUESTS = 20;

describe('Booking race (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let accessToken: string;
  let roomId: string;

  const run = Date.now();
  const email = `race-${run}@e2e.test`;
  const password = 'secret-pass-1';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
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
    await prisma.booking.deleteMany({ where: { roomId } });
    await prisma.room.delete({ where: { id: roomId } });
    await prisma.user.delete({ where: { email } });
    await app.close();
  });

  it(`gives exactly one booking for ${PARALLEL_REQUESTS} parallel requests on one slot`, async () => {
    const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    startsAt.setUTCHours(10, 0, 0, 0);
    const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);

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

    const statusCounts: Record<number, number> = {};
    for (const { status } of responses) {
      statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    }
    const bookingsInDb = await prisma.booking.count({ where: { roomId } });

    expect({ statusCounts, bookingsInDb }).toEqual({
      statusCounts: { 201: 1, 409: PARALLEL_REQUESTS - 1 },
      bookingsInDb: 1,
    });
  });
});
