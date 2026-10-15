import { ApiResponse } from '@nestjs/swagger';
import { STATUS_CODES } from 'node:http';
import { ErrorResponseDto } from '../dto/error-response.dto';

interface ErrorExample {
  message: string;
  details?: string[];
}

interface ApiErrorResponseOptions {
  status: number;
  path: string;
  description?: string;
  examples: [string | ErrorExample, ...(string | ErrorExample)[]];
}

export function ApiErrorResponse({
  status,
  path,
  description,
  examples,
}: ApiErrorResponseOptions): MethodDecorator & ClassDecorator {
  const bodies: ErrorResponseDto[] = examples.map((example) => {
    const { message, details } =
      typeof example === 'string'
        ? { message: example, details: undefined }
        : example;
    return {
      statusCode: status,
      error: STATUS_CODES[status] ?? 'Error',
      message,
      ...(details && { details }),
      path,
      timestamp: '2026-10-13T10:00:00.000Z',
    };
  });

  return ApiResponse({
    status,
    type: ErrorResponseDto,
    description: description ?? bodies[0].message,
    ...(bodies.length === 1
      ? { example: bodies[0] }
      : {
          examples: Object.fromEntries(
            bodies.map((body) => {
              const summary = body.details?.[0] ?? body.message;
              return [summary, { summary, value: body }];
            }),
          ),
        }),
  });
}
