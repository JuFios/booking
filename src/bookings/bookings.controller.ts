import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { BookingsService } from './bookings.service';
import { BookingPageDto, BookingResponseDto } from './dto/booking-response.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { ListBookingsQueryDto } from './dto/list-bookings-query.dto';

@ApiTags('bookings')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'Missing or invalid access token',
})
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post()
  @ApiOperation({ summary: 'Book a room' })
  @ApiCreatedResponse({ type: BookingResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Invalid input, wrong time range, inactive room or too many attendees',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Room not found',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'Room is already booked for this time',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBookingDto,
  ): Promise<BookingResponseDto> {
    return this.bookingsService.create(user.id, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List bookings: a member sees own bookings, an admin sees all',
  })
  @ApiOkResponse({ type: BookingPageDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListBookingsQueryDto,
  ): Promise<BookingPageDto> {
    return this.bookingsService.findAll(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a booking (owner or admin)' })
  @ApiOkResponse({ type: BookingResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'The booking belongs to another user',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Booking not found',
  })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BookingResponseDto> {
    return this.bookingsService.findOne(user, id);
  }
}
