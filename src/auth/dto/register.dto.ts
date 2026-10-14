import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
  NotContains,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'jane@example.com', maxLength: 254 })
  // Emails are stored in lower case, so Jane@Example.com and jane@example.com are one user
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    example: 'correct-horse-battery',
    minLength: 8,
    maxLength: 128,
  })
  @IsString()
  @MinLength(8)
  // Upper bound keeps hashing time predictable for very long inputs
  @MaxLength(128)
  password!: string;

  @ApiProperty({ example: 'Jane Doe', maxLength: 100 })
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
