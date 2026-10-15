import { Prisma } from '../../generated/prisma/client';

// Postgres error codes that Prisma 7 driver adapters expose as originalCode
const EXCLUSION_VIOLATION = '23P01';
const FOREIGN_KEY_VIOLATION = '23503';
const DEADLOCK_DETECTED = '40P01';
const SERIALIZATION_FAILURE = '40001';
const LOCK_NOT_AVAILABLE = '55P03'; // lock_timeout expired

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

// Name of the violated foreign key constraint, if the error is one
export function getForeignKeyViolation(error: unknown): string | undefined {
  const cause = getDatabaseErrorCause(error);
  return cause?.originalCode === FOREIGN_KEY_VIOLATION
    ? cause.constraint?.index
    : undefined;
}

export function isForeignKeyViolation(error: unknown): boolean {
  return getDatabaseErrorCause(error)?.originalCode === FOREIGN_KEY_VIOLATION;
}

// A deadlock or a serialization failure: the transaction can simply be retried.
// ORM queries report it as P2034, raw queries as P2010 with the Postgres code
export function isWriteConflict(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2034'
  ) {
    return true;
  }

  const code = getDatabaseErrorCause(error)?.originalCode;
  return code === DEADLOCK_DETECTED || code === SERIALIZATION_FAILURE;
}

export function isLockTimeout(error: unknown): boolean {
  return getDatabaseErrorCause(error)?.originalCode === LOCK_NOT_AVAILABLE;
}
