import { ApiProperty } from '@nestjs/swagger';
import { Role } from '../../generated/prisma/client';

export class UserResponseDto {
  @ApiProperty({ example: '3f1c7e2a-8b4d-4c2e-9f6a-1d2e3f4a5b6c' })
  id!: string;

  @ApiProperty({ example: 'jane@example.com' })
  email!: string;

  @ApiProperty({ example: 'Jane Doe' })
  name!: string;

  @ApiProperty({ enum: Role, example: Role.member })
  role!: Role;

  @ApiProperty({ example: '2026-10-13T10:00:00.000Z' })
  createdAt!: Date;
}
