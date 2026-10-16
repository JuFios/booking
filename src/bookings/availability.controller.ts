import {
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator';
import { BookingsService } from './bookings.service';
import { AvailabilityQueryDto } from './dto/availability-query.dto';
import { AvailabilityResponseDto } from './dto/availability-response.dto';

const AVAILABILITY_PATH =
  '/rooms/8c1f2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f/availability?date=2026-10-20';

@ApiTags('rooms')
@ApiBearerAuth()
@ApiErrorResponse({
  status: HttpStatus.UNAUTHORIZED,
  path: AVAILABILITY_PATH,
  description: 'Missing or invalid access token',
  examples: ['Missing access token', 'Invalid or expired access token'],
})
@Controller('rooms')
export class AvailabilityController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Get(':id/availability')
  @ApiOperation({ summary: 'Free time slots of a room for one day (UTC)' })
  @ApiOkResponse({
    type: AvailabilityResponseDto,
    description: 'Free time slots of the day',
  })
  @ApiErrorResponse({
    status: HttpStatus.BAD_REQUEST,
    path: AVAILABILITY_PATH,
    description: 'Invalid date or room id',
    examples: [
      {
        message: 'Validation failed',
        details: ['date must be in YYYY-MM-DD format'],
      },
      'Validation failed (uuid is expected)',
    ],
  })
  @ApiErrorResponse({
    status: HttpStatus.NOT_FOUND,
    path: AVAILABILITY_PATH,
    examples: ['Room not found'],
  })
  getAvailability(
    @Param('id', ParseUUIDPipe) roomId: string,
    @Query() query: AvailabilityQueryDto,
  ): Promise<AvailabilityResponseDto> {
    return this.bookingsService.getAvailability(roomId, query.date);
  }
}
