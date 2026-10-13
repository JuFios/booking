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
import { ErrorResponseDto } from '../dto/error-response.dto';

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
