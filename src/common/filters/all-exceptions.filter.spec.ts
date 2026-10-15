import { ArgumentsHost } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { AllExceptionsFilter } from './all-exceptions.filter';

// Raw queries report Postgres errors in meta.driverAdapterError.cause
const raw = (originalCode: string) => ({
  driverAdapterError: { cause: { originalCode } },
});

function respond(code: string, meta?: Record<string, unknown>) {
  const json = jest.fn();
  const status = jest.fn<{ json: jest.Mock }, [number]>(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', url: '/' }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;

  new AllExceptionsFilter().catch(
    new Prisma.PrismaClientKnownRequestError('db error', {
      code,
      clientVersion: 'test',
      meta,
    }),
    host,
  );

  return {
    statusCode: status.mock.calls[0][0],
    message: (json.mock.calls[0] as [{ message: string }])[0].message,
  };
}

describe('AllExceptionsFilter: Prisma errors', () => {
  it.each([
    ['P2002', undefined, 409],
    ['P2025', undefined, 404],
    ['P2034', undefined, 409],
    ['P2028', undefined, 503],
    ['P9999', undefined, 500],
    ['P2010', raw('40P01'), 409], // deadlock in a raw query
    ['P2010', raw('40001'), 409], // serialization failure
    ['P2010', raw('55P03'), 503], // lock_timeout expired
    ['P2010', raw('23P01'), 409], // exclusion violation
    ['P2010', raw('23503'), 409], // foreign key violation
    ['P2010', raw('22001'), 500], // any other database error
  ])('maps %s %j to %i', (code, meta, expected) => {
    expect(respond(code, meta).statusCode).toBe(expected);
  });

  it('does not claim that a referenced row is missing on a foreign key violation', () => {
    expect(respond('P2010', raw('23503')).message).toBe(
      'The operation conflicts with related records',
    );
  });
});
