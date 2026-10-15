import { Prisma } from '../../generated/prisma/client';

// Postgres error codes that Prisma 7 driver adapters expose as originalCode
const EXCLUSION_VIOLATION = '23P01';
const FOREIGN_KEY_VIOLATION = '23503';

interface DatabaseErrorCause {
  originalCode?: string;
  constraint?: { index?: string };
}

// Prisma 7 driver adapters wrap the Postgres error: the original code and the
// constraint name are in meta.driverAdapterError.cause
function getDatabaseErrorCause(error: unknown): DatabaseErrorCause | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return undefined;
  }

  const meta = error.meta as
    { driverAdapterError?: { cause?: DatabaseErrorCause } } | undefined;
  return meta?.driverAdapterError?.cause;
}

export function isExclusionViolation(error: unknown): boolean {
  return getDatabaseErrorCause(error)?.originalCode === EXCLUSION_VIOLATION;
}

export function isForeignKeyViolation(error: unknown): boolean {
  return getDatabaseErrorCause(error)?.originalCode === FOREIGN_KEY_VIOLATION;
}

// Name of the violated foreign key constraint, if the error is one
export function getForeignKeyViolation(error: unknown): string | undefined {
  const cause = getDatabaseErrorCause(error);
  return cause?.originalCode === FOREIGN_KEY_VIOLATION
    ? cause.constraint?.index
    : undefined;
}
