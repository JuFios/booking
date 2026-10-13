import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateRoomDto } from './create-room.dto';

export class UpdateRoomDto extends PartialType(CreateRoomDto) {
  @ApiPropertyOptional({
    example: false,
    description: 'Set to false to deactivate the room',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
