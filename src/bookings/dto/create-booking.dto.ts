import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  NotContains,
} from 'class-validator';

// All times are passed in UTC: an explicit Z avoids guessing the client's time zone
const UTC_SUFFIX = /Z$/;

export class CreateBookingDto {
  @ApiProperty({ example: '8c1f2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f' })
  @IsUUID()
  roomId!: string;

  @ApiProperty({ example: 'Sprint planning', maxLength: 200 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @NotContains('\0', { message: 'title must not contain null characters' })
  title!: string;

  @ApiProperty({
    example: '2026-10-20T10:00:00.000Z',
    description: 'ISO 8601 in UTC',
  })
  @IsISO8601({ strict: true })
  @Matches(UTC_SUFFIX, { message: 'startsAt must be in UTC (end with Z)' })
  startsAt!: string;

  @ApiProperty({
    example: '2026-10-20T11:00:00.000Z',
    description: 'ISO 8601 in UTC',
  })
  @IsISO8601({ strict: true })
  @Matches(UTC_SUFFIX, { message: 'endsAt must be in UTC (end with Z)' })
  endsAt!: string;

  @ApiProperty({ example: 6, minimum: 1, maximum: 1000 })
  @IsInt()
  @Min(1)
  @Max(1000)
  attendeesCount!: number;
}
