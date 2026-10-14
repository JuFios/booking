import { ApiProperty } from '@nestjs/swagger';
import { PageMetaDto } from '../../common/dto/page-meta.dto';

export class EquipmentResponseDto {
  @ApiProperty({ example: '3f1c7e2a-8b4d-4c2e-9f6a-1d2e3f4a5b6c' })
  id!: string;

  @ApiProperty({ example: 'Projector' })
  name!: string;

  @ApiProperty({ example: '2026-10-13T10:00:00.000Z' })
  createdAt!: Date;
}

export class EquipmentPageDto extends PageMetaDto {
  @ApiProperty({ type: [EquipmentResponseDto] })
  items!: EquipmentResponseDto[];
}
