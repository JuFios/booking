import express from 'express';
import { Writable } from 'node:stream';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { REQUEST_ID_HEADER, createPinoHttpOptions } from './logger.config';

interface LogLine {
  level: number;
  msg: string;
  userId?: string;
  responseTime: number;
  req: { id: string; method: string; url: string };
  res: { statusCode: number };
}

const INFO = 30;
const WARN = 40;
const ERROR = 50;

function createApp() {
  const output: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      output.push(chunk.toString());
      done();
    },
  });

  const app = express();
  app.use(express.json());
  app.use(pinoHttp(createPinoHttpOptions('info'), stream));
  app.use((req, _res, next) => {
    if (req.headers['x-test-user']) {
      Object.assign(req, { user: { id: req.headers['x-test-user'] } });
    }
    next();
  });
  app.get('/ok', (_req, res) => void res.json({ ok: true }));
  app.post('/ok', (_req, res) => void res.status(201).json({ ok: true }));
  app.get('/health', (_req, res) => void res.json({ status: 'ok' }));
  app.get('/missing', (_req, res) => void res.status(404).json({}));
  app.get('/boom', (_req, res) => void res.status(500).json({}));

  const logs = async (): Promise<LogLine[]> => {
    await new Promise((resolve) => setImmediate(resolve));
    return output
      .join('')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LogLine);
  };

  return { app, logs, raw: () => output.join('') };
}

describe('request logging', () => {
  it('writes one JSON line per request with method, url, status and time', async () => {
    const { app, logs } = createApp();

    await request(app).get('/ok?page=2').expect(200);

    const [line, ...rest] = await logs();
    expect(rest).toEqual([]);
    expect(line).toMatchObject({
      level: INFO,
      req: { method: 'GET', url: '/ok?page=2' },
      res: { statusCode: 200 },
    });
    expect(line.responseTime).toEqual(expect.any(Number));
  });

  it('logs only method, url, id and status: no headers and no body', async () => {
    const { app, logs, raw } = createApp();

    await request(app)
      .post('/ok')
      .set('Authorization', 'Bearer secret-access-token')
      .set('Cookie', 'session=secret-cookie')
      .send({ password: 'secret-password', refreshToken: 'secret-refresh' })
      .expect(201);

    const [line] = await logs();
    expect(Object.keys(line.req).sort()).toEqual(['id', 'method', 'url']);
    expect(Object.keys(line.res)).toEqual(['statusCode']);
    expect(raw()).not.toMatch(/secret/);
  });

  it.each([
    ['/ok', INFO],
    ['/missing', WARN],
    ['/boom', ERROR],
  ])('logs %s at level %i', async (url, level) => {
    const { app, logs } = createApp();

    await request(app).get(url);

    expect((await logs())[0].level).toBe(level);
  });

  it('adds the user id for an authenticated request and omits it otherwise', async () => {
    const { app, logs } = createApp();

    await request(app).get('/ok').set('x-test-user', 'user-1');
    await request(app).get('/ok');

    const [authenticated, anonymous] = await logs();
    expect(authenticated.userId).toBe('user-1');
    expect(anonymous).not.toHaveProperty('userId');
  });

  it('does not log health checks', async () => {
    const { app, logs } = createApp();

    await request(app).get('/health').expect(200);

    expect(await logs()).toEqual([]);
  });

  describe('request id', () => {
    it('is generated, logged and returned in the response header', async () => {
      const { app, logs } = createApp();

      const response = await request(app).get('/ok');

      const [line] = await logs();
      expect(line.req.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(response.headers[REQUEST_ID_HEADER]).toBe(line.req.id);
    });

    it('is taken from the request header when it is safe', async () => {
      const { app, logs } = createApp();

      const response = await request(app)
        .get('/ok')
        .set(REQUEST_ID_HEADER, 'trace-123.abc');

      expect((await logs())[0].req.id).toBe('trace-123.abc');
      expect(response.headers[REQUEST_ID_HEADER]).toBe('trace-123.abc');
    });

    it.each([
      ['has spaces', 'two words'],
      ['is too long', 'a'.repeat(65)],
      ['has quotes', '"x":1'],
    ])('is replaced when the header value %s', async (_, value) => {
      const { app, logs } = createApp();

      await request(app).get('/ok').set(REQUEST_ID_HEADER, value);

      expect((await logs())[0].req.id).toMatch(/^[0-9a-f-]{36}$/);
    });
  });
});
