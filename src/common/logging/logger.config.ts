import { randomUUID } from 'node:crypto';
import { type Options } from 'pino-http';
import { type AuthenticatedRequest } from '../decorators/current-user.decorator';

export const REQUEST_ID_HEADER = 'x-request-id';

const ACCEPTED_REQUEST_ID = /^[\w.-]{1,64}$/;
const NOT_LOGGED_URLS = ['/health'];

export const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export function createPinoHttpOptions(level: LogLevel): Options {
  return {
    level,
    genReqId: (req, res) => {
      const incoming = req.headers[REQUEST_ID_HEADER];
      const id =
        typeof incoming === 'string' && ACCEPTED_REQUEST_ID.test(incoming)
          ? incoming
          : randomUUID();
      res.setHeader(REQUEST_ID_HEADER, id);
      return id;
    },
    serializers: {
      req: (req: { id: string; method: string; url: string }) => ({
        id: req.id,
        method: req.method,
        url: req.url,
      }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
    customLogLevel: (_req, res, error) => {
      if (error || res.statusCode >= 500) {
        return 'error';
      }
      return res.statusCode >= 400 ? 'warn' : 'info';
    },
    customProps: (req) => ({
      userId: (req as Partial<AuthenticatedRequest>).user?.id,
    }),
    autoLogging: {
      ignore: (req) => NOT_LOGGED_URLS.includes(req.url ?? ''),
    },
  };
}
