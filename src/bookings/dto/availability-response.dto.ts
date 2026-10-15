import { ApiProperty } from '@nestjs/swagger';

export class TimeSlotDto {
  @ApiProperty({ example: '2026-10-20T11:00:00.000Z' })
  startsAt!: Date;

  @ApiProperty({ example: '2026-10-20T14:30:00.000Z' })
  endsAt!: Date;
}

export class AvailabilityResponseDto {
  @ApiProperty({ example: '8c1f2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f' })
  roomId!: string;

  @ApiProperty({ example: '2026-10-20' })
  date!: string;

  @ApiProperty({
    type: [TimeSlotDto],
    description:
      'Free time ranges of at least 15 minutes. Empty if the room is inactive or the day is over',
  })
  slots!: TimeSlotDto[];
}
