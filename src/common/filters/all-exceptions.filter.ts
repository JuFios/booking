import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { STATUS_CODES } from 'node:http';
import { Prisma } from '../../generated/prisma/client';
import { ErrorResponseDto } from '../dto/error-response.dto';
import {
  isExclusionViolation,
  isForeignKeyViolation,
  isLockTimeout,
  isWriteConflict,
} from '../utils/database-errors';

// Also used in the Swagger examples
export const CONCURRENT_UPDATE_CONFLICT =
  'Concurrent update conflict, try again';
export const DATABASE_BUSY = 'Database is busy, try again';

interface ResolvedError {
  statusCode: number;
  message: string;
  details?: string[];
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const { statusCode, message, details } = this.resolve(exception);

    if (statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else if (isWriteConflict(exception)) {
      // answered with 409, but a deadlock is not expected: keep it visible
      this.logger.warn(
        `${request.method} ${request.url}: deadlock or write conflict`,
      );
    }

    const body: ErrorResponseDto = {
      statusCode,
      error: STATUS_CODES[statusCode] ?? 'Error',
      message,
      ...(details && { details }),
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    response.status(statusCode).json(body);
  }

  private resolve(exception: unknown): ResolvedError {
    if (exception instanceof HttpException) {
      return this.resolveHttpException(exception);
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const prismaError = this.resolvePrismaError(exception);
      if (prismaError) {
        return prismaError;
      }
    }

    const clientErrorStatus = this.getClientErrorStatus(exception);
    if (clientErrorStatus) {
      return {
        statusCode: clientErrorStatus,
        message:
          exception instanceof Error
            ? exception.message
            : (STATUS_CODES[clientErrorStatus] ?? 'Error'),
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    };
  }

  private resolvePrismaError(
    exception: Prisma.PrismaClientKnownRequestError,
  ): ResolvedError | undefined {
    const meta = exception.meta as
      { model?: string; modelName?: string } | undefined;
    const model = meta?.model ?? meta?.modelName ?? 'Record';

    if (isWriteConflict(exception)) {
      return {
        statusCode: HttpStatus.CONFLICT,
        message: CONCURRENT_UPDATE_CONFLICT,
      };
    }

    switch (exception.code) {
      case 'P2002': // unique constraint violation
        return {
          statusCode: HttpStatus.CONFLICT,
          message: `${model} already exists`,
        };
      case 'P2025': // record required for the operation was not found
        return {
          statusCode: HttpStatus.NOT_FOUND,
          message: `${model} not found`,
        };
      case 'P2028': // interactive transaction could not start or ran out of time
        return this.databaseBusy();
      default:
        return this.resolveRawQueryError(exception);
    }
  }

  // Raw queries report database errors as P2010 (or without a specific code):
  // the Postgres error is in meta.driverAdapterError.cause
  private resolveRawQueryError(
    exception: Prisma.PrismaClientKnownRequestError,
  ): ResolvedError | undefined {
    if (isLockTimeout(exception)) {
      return this.databaseBusy();
    }
    if (isExclusionViolation(exception)) {
      return {
        statusCode: HttpStatus.CONFLICT,
        message: 'The operation conflicts with an existing record',
      };
    }
    // Also raised when a row that is still referenced is deleted, so the
    // message does not say which side is missing
    if (isForeignKeyViolation(exception)) {
      return {
        statusCode: HttpStatus.CONFLICT,
        message: 'The operation conflicts with related records',
      };
    }

    return undefined;
  }

  private databaseBusy(): ResolvedError {
    return {
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      message: DATABASE_BUSY,
    };
  }

  // Errors from Express middleware (e.g. body-parser's 413) are not
  // HttpExceptions but carry a 4xx status in the `statusCode` field.
  private getClientErrorStatus(exception: unknown): number | undefined {
    if (typeof exception !== 'object' || exception === null) {
      return undefined;
    }

    const { statusCode } = exception as { statusCode?: unknown };
    const isClientError =
      typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500;

    return isClientError ? statusCode : undefined;
  }

  private resolveHttpException(exception: HttpException): ResolvedError {
    const statusCode = exception.getStatus();
    const payload = exception.getResponse();

    if (typeof payload === 'string') {
      return { statusCode, message: payload };
    }

    const { message } = payload as { message?: unknown };

    if (Array.isArray(message)) {
      return {
        statusCode,
        message: 'Validation failed',
        details: message.map(String),
      };
    }

    return {
      statusCode,
      message: typeof message === 'string' ? message : exception.message,
    };
  }
}
