import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  afterEach(async () => {
    await app.close();
  });

  describe('when the database is up', () => {
    beforeEach(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      app = moduleRef.createNestApplication();
      await app.init();
    });

    it('GET /health returns 200', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(response.body).toEqual({ status: 'ok', db: 'up' });
    });

    it('returns 413 for a request body larger than 100 KB', async () => {
      const response = await request(app.getHttpServer())
        .post('/health')
        .send({ data: 'x'.repeat(200 * 1024) })
        .expect(413);

      expect(response.body).toMatchObject({
        statusCode: 413,
        error: 'Payload Too Large',
        path: '/health',
      });
    });
  });

  describe('when the database is down', () => {
    beforeEach(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(PrismaService)
        .useValue({
          $queryRaw: jest.fn().mockRejectedValue(new Error('connection lost')),
        })
        .compile();

      // the 503 is expected here, so its error log would only be noise
      app = moduleRef.createNestApplication({ logger: false });
      await app.init();
    });

    it('GET /health returns 503 in the common error format', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(503);

      expect(response.body).toEqual({
        statusCode: 503,
        error: 'Service Unavailable',
        message: 'Database is unavailable',
        path: '/health',
        timestamp: expect.any(String) as string,
      });
    });
  });
});
