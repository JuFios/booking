import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { checkBookingTime, checkRoomForBooking } from './booking-rules';
import { BookingResponseDto } from './dto/booking-response.dto';
import { CreateBookingDto } from './dto/create-booking.dto';

const bookingSelect = {
  id: true,
  title: true,
  startsAt: true,
  endsAt: true,
  status: true,
  attendeesCount: true,
  createdAt: true,
  updatedAt: true,
  room: { select: { id: true, name: true } },
  user: { select: { id: true, name: true, email: true } },
} satisfies Prisma.BookingSelect;

@Injectable()
export class BookingsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    userId: string,
    dto: CreateBookingDto,
  ): Promise<BookingResponseDto> {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);

    const timeError = checkBookingTime(startsAt, endsAt, new Date());
    if (timeError) {
      throw new BadRequestException(timeError);
    }

    const room = await this.prisma.room.findUnique({
      where: { id: dto.roomId },
      select: { isActive: true, capacity: true },
    });
    if (!room) {
      throw new NotFoundException('Room not found');
    }

    const roomError = checkRoomForBooking(room, dto.attendeesCount);
    if (roomError) {
      throw new BadRequestException(roomError);
    }

    // Naive check: another request can insert an overlapping booking
    // between this SELECT and the INSERT below
    const overlapping = await this.prisma.booking.findFirst({
      where: {
        roomId: dto.roomId,
        status: 'confirmed',
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
      select: { id: true },
    });
    if (overlapping) {
      throw new ConflictException('Room is already booked for this time');
    }

    return this.prisma.booking.create({
      data: {
        title: dto.title,
        startsAt,
        endsAt,
        attendeesCount: dto.attendeesCount,
        roomId: dto.roomId,
        userId,
      },
      select: bookingSelect,
    });
  }
}
