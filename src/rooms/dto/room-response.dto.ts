import { ApiProperty } from '@nestjs/swagger';
import { PageMetaDto } from '../../common/dto/page-meta.dto';

export class RoomEquipmentDto {
  @ApiProperty({ example: '3f1c7e2a-8b4d-4c2e-9f6a-1d2e3f4a5b6c' })
  id!: string;

  @ApiProperty({ example: 'Projector' })
  name!: string;
}

export class RoomResponseDto {
  @ApiProperty({ example: '8c1f2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f' })
  id!: string;

  @ApiProperty({ example: 'Kyiv' })
  name!: string;

  @ApiProperty({ example: 12 })
  capacity!: number;

  @ApiProperty({ example: 2 })
  floor!: number;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({ type: [RoomEquipmentDto] })
  equipment!: RoomEquipmentDto[];

  @ApiProperty({ example: '2026-10-13T10:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-10-13T10:00:00.000Z' })
  updatedAt!: Date;
}

export class RoomPageDto extends PageMetaDto {
  @ApiProperty({ type: [RoomResponseDto] })
  items!: RoomResponseDto[];
}
