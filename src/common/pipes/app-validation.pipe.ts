import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  ValidationPipe,
} from '@nestjs/common';

@Injectable()
export class AppValidationPipe extends ValidationPipe {
  override async transform(
    value: unknown,
    metadata: ArgumentMetadata,
  ): Promise<unknown> {
    if (
      metadata.type === 'body' &&
      Array.isArray(value) &&
      metadata.metatype !== Array
    ) {
      throw new BadRequestException('Request body must be a JSON object');
    }

    return super.transform(value, metadata);
  }
}
