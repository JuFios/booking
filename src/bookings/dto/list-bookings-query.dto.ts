import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsUUID,
  Matches,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { BookingStatus } from '../../generated/prisma/client';
import { UTC_SUFFIX } from './create-booking.dto';

export class ListBookingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  roomId?: string;

  @ApiPropertyOptional({
    example: '2026-10-20T00:00:00.000Z',
    description: 'Bookings that end after this moment (ISO 8601 in UTC)',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(UTC_SUFFIX, { message: 'from must be in UTC (end with Z)' })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-10-21T00:00:00.000Z',
    description: 'Bookings that start before this moment (ISO 8601 in UTC)',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(UTC_SUFFIX, { message: 'to must be in UTC (end with Z)' })
  to?: string;

  @ApiPropertyOptional({ enum: BookingStatus })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;
}
