import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength, NotContains } from 'class-validator';

export class CreateEquipmentDto {
  @ApiProperty({ example: 'Projector', maxLength: 100 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  // Postgres text cannot store the NUL character (0x00)
  @NotContains('\0', { message: 'name must not contain null characters' })
  name!: string;
}
