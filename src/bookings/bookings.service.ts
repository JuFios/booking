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

    return this.insertBooking({
      title: dto.title,
      startsAt,
      endsAt,
      attendeesCount: dto.attendeesCount,
      roomId: dto.roomId,
      userId,
    });
  }

  // INSERT ... ON CONFLICT DO NOTHING instead of prisma.booking.create():
  // a plain INSERT can deadlock when many overlapping bookings are inserted at
  // once, because the exclusion constraint is checked after the row is written.
  // With ON CONFLICT Postgres checks the Booking_no_overlap constraint first and
  // skips the row, so a taken slot returns no rows instead of an error
  private async insertBooking(data: {
    title: string;
    startsAt: Date;
    endsAt: Date;
    attendeesCount: number;
    roomId: string;
    userId: string;
  }): Promise<BookingResponseDto> {
    const inserted = await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO "Booking"
        (id, title, "startsAt", "endsAt", "attendeesCount", "roomId", "userId", "updatedAt")
      VALUES
        (gen_random_uuid(), ${data.title}, ${data.startsAt}, ${data.endsAt},
         ${data.attendeesCount}, ${data.roomId}::uuid, ${data.userId}::uuid, now())
      ON CONFLICT DO NOTHING
      RETURNING id`;

    if (inserted.length === 0) {
      throw new ConflictException('Room is already booked for this time');
    }

    return this.prisma.booking.findUniqueOrThrow({
      where: { id: inserted[0].id },
      select: bookingSelect,
    });
  }
}
