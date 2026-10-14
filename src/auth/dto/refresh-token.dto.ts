import { ApiProperty } from '@nestjs/swagger';
import { IsJWT } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    description: 'Refresh token from login or the previous refresh',
  })
  @IsJWT()
  refreshToken!: string;
}
