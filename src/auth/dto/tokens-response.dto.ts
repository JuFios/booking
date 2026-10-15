import { ApiProperty } from '@nestjs/swagger';

export const ACCESS_TOKEN_EXAMPLE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzZjFjN2UyYS04YjRkLTRjMmUtOWY2YS0xZDJlM2Y0YTViNmMiLCJyb2xlIjoibWVtYmVyIiwiaWF0IjoxNzkxODg1NjAwLCJleHAiOjE3OTE4ODY1MDB9.ztkNrg21kM7vIdmx-80uCt2IWwlVVCD0KxYD8KKbwxk';
export const REFRESH_TOKEN_EXAMPLE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzZjFjN2UyYS04YjRkLTRjMmUtOWY2YS0xZDJlM2Y0YTViNmMiLCJqdGkiOiI5YjJlNGM2ZC0xYTNmLTRlNWItOGM3ZC0wZjFlMmQzYzRiNWEiLCJpYXQiOjE3OTE4ODU2MDAsImV4cCI6MTc5MjQ5MDQwMH0.7bajLqBfUPPtjMtPXf54l8OGdLD7MJJ-8_LW87vLW0c';

export class TokensResponseDto {
  @ApiProperty({
    description: 'Short-lived token for the Authorization header',
    example: ACCESS_TOKEN_EXAMPLE,
  })
  accessToken!: string;

  @ApiProperty({
    description: 'Long-lived token for POST /auth/refresh',
    example: REFRESH_TOKEN_EXAMPLE,
  })
  refreshToken!: string;
}
