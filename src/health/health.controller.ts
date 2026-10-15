import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator';
import { Public } from '../common/decorators/public.decorator';
import { HealthResponseDto } from './dto/health-response.dto';
import { HealthService } from './health.service';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Check that the API and the database are up' })
  @ApiOkResponse({
    type: HealthResponseDto,
    description: 'The API and the database are up',
  })
  @ApiErrorResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    path: '/health',
    examples: ['Database is unavailable'],
  })
  check(): Promise<HealthResponseDto> {
    return this.healthService.check();
  }
}
