import { ApiProperty } from '@nestjs/swagger';
import { BookingStatus } from '../../generated/prisma/client';

export class BookingRoomDto {
  @ApiProperty({ example: '8c1f2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f' })
  id!: string;

  @ApiProperty({ example: 'Kyiv' })
  name!: string;
}

export class BookingUserDto {
  @ApiProperty({ example: '3f1c7e2a-8b4d-4c2e-9f6a-1d2e3f4a5b6c' })
  id!: string;

  @ApiProperty({ example: 'Jane Doe' })
  name!: string;

  @ApiProperty({ example: 'jane@example.com' })
  email!: string;
}

export class BookingResponseDto {
  @ApiProperty({ example: '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d' })
  id!: string;

  @ApiProperty({ example: 'Sprint planning' })
  title!: string;

  @ApiProperty({ example: '2026-10-20T10:00:00.000Z' })
  startsAt!: Date;

  @ApiProperty({ example: '2026-10-20T11:00:00.000Z' })
  endsAt!: Date;

  @ApiProperty({ enum: BookingStatus, example: BookingStatus.confirmed })
  status!: BookingStatus;

  @ApiProperty({ example: 6 })
  attendeesCount!: number;

  @ApiProperty({ type: BookingRoomDto })
  room!: BookingRoomDto;

  @ApiProperty({ type: BookingUserDto })
  user!: BookingUserDto;

  @ApiProperty({ example: '2026-10-13T10:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-10-13T10:00:00.000Z' })
  updatedAt!: Date;
}
