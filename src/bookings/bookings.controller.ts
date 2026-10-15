import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import {
  BookingsService,
  NOT_OWNER,
  NOTHING_TO_UPDATE,
  ROOM_ALREADY_BOOKED,
} from './bookings.service';
import { BookingPageDto, BookingResponseDto } from './dto/booking-response.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { ListBookingsQueryDto } from './dto/list-bookings-query.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';

const BOOKING_PATH = '/bookings/5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d';

@ApiTags('bookings')
@ApiBearerAuth()
@ApiErrorResponse({
  status: HttpStatus.UNAUTHORIZED,
  path: '/bookings',
  description: 'Missing or invalid access token',
  examples: ['Missing access token', 'Invalid or expired access token'],
})
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post()
  @ApiOperation({ summary: 'Book a room' })
  @ApiCreatedResponse({
    type: BookingResponseDto,
    description: 'The created booking',
  })
  @ApiErrorResponse({
    status: HttpStatus.BAD_REQUEST,
    path: '/bookings',
    description:
      'Invalid input, wrong time range, inactive room or too many attendees',
    examples: [
      {
        message: 'Validation failed',
        details: ['startsAt must be in UTC, e.g. 2026-10-20T10:00:00Z'],
      },
      'Booking must last at least 15 minutes',
      'startsAt must not be in the past',
      'startsAt must be at most 365 days ahead',
      'Room is not active',
      'attendeesCount must not exceed the room capacity (6)',
    ],
  })
  @ApiErrorResponse({
    status: HttpStatus.NOT_FOUND,
    path: '/bookings',
    description: 'Room not found, or the user of the token no longer exists',
    examples: ['Room not found', 'User not found'],
  })
  @ApiErrorResponse({
    status: HttpStatus.CONFLICT,
    path: '/bookings',
    examples: [ROOM_ALREADY_BOOKED],
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
  @ApiOkResponse({ type: BookingPageDto, description: 'A page of bookings' })
  @ApiErrorResponse({
    status: HttpStatus.BAD_REQUEST,
    path: '/bookings',
    description: 'Invalid filters',
    examples: [
      {
        message: 'Validation failed',
        details: [
          'status must be one of the following values: confirmed, cancelled',
        ],
      },
      'from must be earlier than to',
    ],
  })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListBookingsQueryDto,
  ): Promise<BookingPageDto> {
    return this.bookingsService.findAll(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a booking (owner or admin)' })
  @ApiOkResponse({ type: BookingResponseDto, description: 'The booking' })
  @ApiErrorResponse({
    status: HttpStatus.BAD_REQUEST,
    path: '/bookings/abc',
    examples: ['Validation failed (uuid is expected)'],
  })
  @ApiErrorResponse({
    status: HttpStatus.FORBIDDEN,
    path: BOOKING_PATH,
    description: 'The booking belongs to another user',
    examples: [NOT_OWNER],
  })
  @ApiErrorResponse({
    status: HttpStatus.NOT_FOUND,
    path: BOOKING_PATH,
    examples: ['Booking not found'],
  })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BookingResponseDto> {
    return this.bookingsService.findOne(user, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Change the title or time of a booking (owner or admin)',
  })
  @ApiOkResponse({
    type: BookingResponseDto,
    description: 'The updated booking',
  })
  @ApiErrorResponse({
    status: HttpStatus.BAD_REQUEST,
    path: BOOKING_PATH,
    description:
      'Invalid input, wrong time range, inactive room, cancelled or ended booking',
    examples: [
      {
        message: 'Validation failed',
        details: ['endsAt must be in UTC, e.g. 2026-10-20T10:00:00Z'],
      },
      NOTHING_TO_UPDATE,
      'Booking must last at least 15 minutes',
      'endsAt must be in the future',
      'Room is not active',
      'Cancelled booking cannot be changed',
      'Ended booking cannot be changed',
    ],
  })
  @ApiErrorResponse({
    status: HttpStatus.FORBIDDEN,
    path: BOOKING_PATH,
    description: 'The booking belongs to another user',
    examples: [NOT_OWNER],
  })
  @ApiErrorResponse({
    status: HttpStatus.NOT_FOUND,
    path: BOOKING_PATH,
    examples: ['Booking not found'],
  })
  @ApiErrorResponse({
    status: HttpStatus.CONFLICT,
    path: BOOKING_PATH,
    examples: [ROOM_ALREADY_BOOKED],
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBookingDto,
  ): Promise<BookingResponseDto> {
    return this.bookingsService.update(user, id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a booking (owner or admin); the record is kept',
  })
  @ApiOkResponse({
    type: BookingResponseDto,
    description: 'The cancelled booking',
  })
  @ApiErrorResponse({
    status: HttpStatus.BAD_REQUEST,
    path: `${BOOKING_PATH}/cancel`,
    description: 'Booking is already cancelled or has ended, or invalid id',
    examples: [
      'Booking is already cancelled',
      'Ended booking cannot be cancelled',
      'Validation failed (uuid is expected)',
    ],
  })
  @ApiErrorResponse({
    status: HttpStatus.FORBIDDEN,
    path: `${BOOKING_PATH}/cancel`,
    description: 'The booking belongs to another user',
    examples: [NOT_OWNER],
  })
  @ApiErrorResponse({
    status: HttpStatus.NOT_FOUND,
    path: `${BOOKING_PATH}/cancel`,
    examples: ['Booking not found'],
  })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BookingResponseDto> {
    return this.bookingsService.cancel(user, id);
  }
}
