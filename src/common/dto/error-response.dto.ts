import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode!: number;

  @ApiProperty({ example: 'Bad Request' })
  error!: string;

  @ApiProperty({ example: 'Validation failed' })
  message!: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['email must be an email'],
  })
  details?: string[];

  @ApiProperty({ example: '/auth/register' })
  path!: string;

  @ApiProperty({ example: '2026-10-13T10:00:00.000Z' })
  timestamp!: string;
}
