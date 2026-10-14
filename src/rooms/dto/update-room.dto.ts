import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, ValidateIf } from 'class-validator';
import { CreateRoomDto } from './create-room.dto';

// skipNullProperties: false — fields may be omitted, but an explicit null is
// validated (and rejected) instead of reaching the database
export class UpdateRoomDto extends PartialType(CreateRoomDto, {
  skipNullProperties: false,
}) {
  @ApiPropertyOptional({
    example: false,
    description: 'Set to false to deactivate the room',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}
