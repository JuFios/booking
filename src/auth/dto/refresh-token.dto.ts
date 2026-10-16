import { ApiProperty } from '@nestjs/swagger';
import { IsJWT } from 'class-validator';
import { REFRESH_TOKEN_EXAMPLE } from './tokens-response.dto';

export class RefreshTokenDto {
  @ApiProperty({
    description: 'Refresh token from login or the previous refresh',
    example: REFRESH_TOKEN_EXAMPLE,
  })
  @IsJWT()
  refreshToken!: string;
}
