import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class ListRoomsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 6, description: 'Minimum capacity' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  minCapacity?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-10)
  @Max(200)
  floor?: number;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description:
      'Equipment ids; the room must have all of them. Repeat the parameter or separate ids with commas',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    (Array.isArray(value) ? value : [value])
      .flatMap((item) => String(item).split(','))
      .map((item) => item.trim())
      .filter(Boolean),
  )
  @IsUUID('all', { each: true })
  equipment?: string[];

  @ApiPropertyOptional({
    type: Boolean,
    description: 'true: only rooms that can be booked; false: only inactive',
  })
  @IsOptional()
  // Query values are strings: only "true" and "false" become booleans,
  // anything else stays a string and fails @IsBoolean
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  isActive?: boolean;
}
