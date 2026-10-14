import { ApiProperty } from '@nestjs/swagger';

export class TokensResponseDto {
  @ApiProperty({
    description: 'Short-lived token for the Authorization header',
  })
  accessToken!: string;

  @ApiProperty({ description: 'Long-lived token for POST /auth/refresh' })
  refreshToken!: string;
}
