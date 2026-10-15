import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { BookingsService } from './bookings.service';
import { AvailabilityQueryDto } from './dto/availability-query.dto';
import { AvailabilityResponseDto } from './dto/availability-response.dto';

@ApiTags('rooms')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'Missing or invalid access token',
})
@Controller('rooms')
export class AvailabilityController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Get(':id/availability')
  @ApiOperation({ summary: 'Free time slots of a room for one day (UTC)' })
  @ApiOkResponse({ type: AvailabilityResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Room not found',
  })
  getAvailability(
    @Param('id', ParseUUIDPipe) roomId: string,
    @Query() query: AvailabilityQueryDto,
  ): Promise<AvailabilityResponseDto> {
    return this.bookingsService.getAvailability(roomId, query.date);
  }
}
