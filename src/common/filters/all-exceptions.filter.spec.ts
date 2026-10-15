import { ArgumentsHost } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { AllExceptionsFilter } from './all-exceptions.filter';

function statusFor(code: string): number {
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
    }),
    host,
  );

  return status.mock.calls[0][0];
}

describe('AllExceptionsFilter: Prisma errors', () => {
  it.each([
    ['P2002', 409],
    ['P2025', 404],
    ['P2034', 409],
    ['P2028', 503],
    ['P9999', 500],
  ])('maps %s to %i', (code, expected) => {
    expect(statusFor(code)).toBe(expected);
  });
});
