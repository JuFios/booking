import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, Matches } from 'class-validator';

export class AvailabilityQueryDto {
  @ApiProperty({ example: '2026-10-20', description: 'Day in UTC' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date must be in YYYY-MM-DD format',
  })
  @IsISO8601({ strict: true })
  date!: string;
}
