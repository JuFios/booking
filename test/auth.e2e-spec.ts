import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { TokensResponseDto } from '../src/auth/dto/tokens-response.dto';
import { RefreshTokenCleanupService } from '../src/auth/refresh-token-cleanup.service';
import {
  REUSE_GRACE_PERIOD_MS,
  RefreshTokenPayload,
} from '../src/auth/tokens.service';
import { useRequestLogging } from '../src/common/logging/request-logging';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  // Random, not Date.now(): parallel e2e files can start in the same ms
  const run = randomUUID();
  const emailFor = (name: string) => `${name}-${run}@e2e.test`;
  const password = 'secret-pass-1';

  const register = (name: string) =>
    request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: emailFor(name), password, name });

  const login = async (email: string): Promise<TokensResponseDto> => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return response.body as TokensResponseDto;
  };

  const refresh = (refreshToken: string) =>
    request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken });

  // Moves the token's revocation into the past, as if the grace period is over
  const expireGracePeriod = async (refreshToken: string) => {
    const { jti } = JSON.parse(
      Buffer.from(refreshToken.split('.')[1], 'base64url').toString(),
    ) as RefreshTokenPayload;
    await prisma.refreshToken.update({
      where: { id: jti },
      data: { revokedAt: new Date(Date.now() - REUSE_GRACE_PERIOD_MS - 1000) },
    });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    useRequestLogging(app);
    await app.init();
    prisma = app.get(PrismaService);

    // Admins cannot register through the API, so this one is created directly
    await prisma.user.create({
      data: {
        email: emailFor('admin'),
        name: 'Admin',
        role: 'admin',
        passwordHash: await argon2.hash(password),
      },
    });
  });

  afterAll(async () => {
    await prisma.equipment.deleteMany({
      where: { name: { startsWith: `E2E ${run}` } },
    });
    // Refresh tokens are removed by the cascade
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@e2e.test` } },
    });
    await app.close();
  });

  describe('POST /auth/register', () => {
    it('creates a member and never returns the password hash', async () => {
      const response = await register('jane').expect(201);

      expect(response.body).toEqual({
        id: expect.any(String) as string,
        email: emailFor('jane'),
        name: 'jane',
        role: 'member',
        createdAt: expect.any(String) as string,
      });
    });

    it('returns 409 for an email that is already taken, in any case', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: emailFor('jane').toUpperCase(), password, name: 'Jane' })
        .expect(409);
    });

    it('returns 400 when the client tries to set a role', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: emailFor('mallory'),
          password,
          name: 'M',
          role: 'admin',
        })
        .expect(400);

      expect(response.body).toMatchObject({
        details: ['property role should not exist'],
      });
    });
  });

  describe('POST /auth/login', () => {
    it('returns an access and a refresh token', async () => {
      const tokens = await login(emailFor('jane'));

      expect(tokens).toEqual({
        accessToken: expect.any(String) as string,
        refreshToken: expect.any(String) as string,
      });
    });

    it('gives the same 401 for a wrong password and an unknown email', async () => {
      const wrongPassword = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: emailFor('jane'), password: 'wrong-password' })
        .expect(401);
      const unknownEmail = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: emailFor('nobody'), password: 'wrong-password' })
        .expect(401);

      expect(wrongPassword.body).toMatchObject({
        message: 'Invalid email or password',
      });
      expect(unknownEmail.body).toMatchObject({
        message: 'Invalid email or password',
      });
    });
  });

  describe('GET /users/me', () => {
    it('returns 401 without a token', async () => {
      await request(app.getHttpServer()).get('/users/me').expect(401);
    });

    it('returns 401 when a refresh token is used as an access token', async () => {
      const { refreshToken } = await login(emailFor('jane'));

      await request(app.getHttpServer())
        .get('/users/me')
        .auth(refreshToken, { type: 'bearer' })
        .expect(401);
    });

    it('returns the current user without the password hash', async () => {
      const { accessToken } = await login(emailFor('jane'));

      const response = await request(app.getHttpServer())
        .get('/users/me')
        .auth(accessToken, { type: 'bearer' })
        .expect(200);

      expect(response.body).toMatchObject({ email: emailFor('jane') });
      expect(response.body).not.toHaveProperty('passwordHash');
    });

    it('accepts the Bearer scheme in any case', async () => {
      const { accessToken } = await login(emailFor('jane'));

      for (const scheme of ['bearer', 'BEARER', 'Bearer']) {
        await request(app.getHttpServer())
          .get('/users/me')
          .set('Authorization', `${scheme} ${accessToken}`)
          .expect(200);
      }
      await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Basic ${accessToken}`)
        .expect(401);
    });
  });

  describe('POST /auth/refresh', () => {
    it('returns a new pair and makes the used refresh token invalid', async () => {
      const first = await login(emailFor('jane'));

      const response = await refresh(first.refreshToken).expect(200);
      const second = response.body as TokensResponseDto;

      expect(second.refreshToken).not.toBe(first.refreshToken);
      await refresh(first.refreshToken).expect(401);
    });

    it('lets one of two parallel refreshes win and keeps the session', async () => {
      await register('parallel').expect(201);
      const { refreshToken } = await login(emailFor('parallel'));

      const responses = await Promise.all([
        refresh(refreshToken),
        refresh(refreshToken),
      ]);

      const statuses = responses.map((response) => response.status).sort();
      expect(statuses).toEqual([200, 401]);
      // Within the grace period the loser is not treated as theft
      const winner = responses.find((response) => response.status === 200);
      const tokens = winner?.body as TokensResponseDto;
      await refresh(tokens.refreshToken).expect(200);
    });

    it('revokes every session of the user when a used token comes back after the grace period', async () => {
      await register('reuse').expect(201);
      const stolen = await login(emailFor('reuse'));
      const otherSession = await login(emailFor('reuse'));

      await refresh(stolen.refreshToken).expect(200);
      await expireGracePeriod(stolen.refreshToken);
      // Second use of the same token: looks like theft
      await refresh(stolen.refreshToken).expect(401);

      await refresh(otherSession.refreshToken).expect(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('requires an access token', async () => {
      const { refreshToken } = await login(emailFor('jane'));

      await request(app.getHttpServer())
        .post('/auth/logout')
        .send({ refreshToken })
        .expect(401);
    });

    it('revokes the refresh token', async () => {
      const { accessToken, refreshToken } = await login(emailFor('jane'));

      await request(app.getHttpServer())
        .post('/auth/logout')
        .auth(accessToken, { type: 'bearer' })
        .send({ refreshToken })
        .expect(204);

      await refresh(refreshToken).expect(401);
    });
  });

  describe('roles', () => {
    it('returns 403 when a member creates equipment', async () => {
      const { accessToken } = await login(emailFor('jane'));

      await request(app.getHttpServer())
        .post('/equipment')
        .auth(accessToken, { type: 'bearer' })
        .send({ name: `E2E ${run} member` })
        .expect(403);
    });

    it('lets an admin create equipment', async () => {
      const { accessToken } = await login(emailFor('admin'));

      await request(app.getHttpServer())
        .post('/equipment')
        .auth(accessToken, { type: 'bearer' })
        .send({ name: `E2E ${run} admin` })
        .expect(201);
    });
  });

  describe('refresh token cleanup', () => {
    it('deletes expired tokens and keeps revoked ones until they expire', async () => {
      await register('cleanup').expect(201);
      const user = await prisma.user.findUniqueOrThrow({
        where: { email: emailFor('cleanup') },
      });
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const inAWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const [expired, revoked, active] = await Promise.all([
        prisma.refreshToken.create({
          data: { userId: user.id, expiresAt: hourAgo },
        }),
        prisma.refreshToken.create({
          data: { userId: user.id, expiresAt: inAWeek, revokedAt: hourAgo },
        }),
        prisma.refreshToken.create({
          data: { userId: user.id, expiresAt: inAWeek },
        }),
      ]);

      await app.get(RefreshTokenCleanupService).deleteExpired();

      const left = await prisma.refreshToken.findMany({
        where: { userId: user.id },
        select: { id: true },
      });
      const leftIds = left.map((token) => token.id);
      expect(leftIds).not.toContain(expired.id);
      expect(leftIds).toEqual(expect.arrayContaining([revoked.id, active.id]));
    });
  });
});
