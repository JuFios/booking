import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  NotContains,
} from 'class-validator';

export class CreateRoomDto {
  @ApiProperty({ example: 'Kyiv', maxLength: 100 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  // Postgres text cannot store the NUL character (0x00)
  @NotContains('\0', { message: 'name must not contain null characters' })
  name!: string;

  @ApiProperty({ example: 12, minimum: 1, maximum: 1000 })
  @IsInt()
  @Min(1)
  @Max(1000)
  capacity!: number;

  @ApiProperty({ example: 2, minimum: -10, maximum: 200 })
  @IsInt()
  @Min(-10)
  @Max(200)
  floor!: number;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    example: ['3f1c7e2a-8b4d-4c2e-9f6a-1d2e3f4a5b6c'],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  equipmentIds?: string[];
}
