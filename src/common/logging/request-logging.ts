import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { pinoHttp } from 'pino-http';
import { createPinoHttpOptions, type LogLevel } from './logger.config';

// Must be called before app.init(): init() adds the body parser, and a request
// it rejects (invalid JSON, 413) never reaches middleware registered later, so
// it would get no log line and no x-request-id. LoggerModule runs with
// useExisting and only binds this req.log to the application logs
export function useRequestLogging(app: INestApplication): void {
  const level = app.get(ConfigService).getOrThrow<LogLevel>('LOG_LEVEL');
  app.use(pinoHttp(createPinoHttpOptions(level)));
}
