import { PartialType, PickType } from '@nestjs/swagger';
import { CreateBookingDto } from './create-booking.dto';

export class UpdateBookingDto extends PartialType(
  PickType(CreateBookingDto, ['title', 'startsAt', 'endsAt'] as const),
  { skipNullProperties: false },
) {}
