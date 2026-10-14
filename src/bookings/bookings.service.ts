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

    return this.prisma.$transaction(async (tx) => {
      // FOR UPDATE locks the room row until the transaction ends: a parallel
      // booking of the same room waits here and then sees the first booking
      const [room] = await tx.$queryRaw<
        { isActive: boolean; capacity: number }[]
      >`SELECT "isActive", capacity FROM "Room" WHERE id = ${dto.roomId}::uuid FOR UPDATE`;
      if (!room) {
        throw new NotFoundException('Room not found');
      }

      const roomError = checkRoomForBooking(room, dto.attendeesCount);
      if (roomError) {
        throw new BadRequestException(roomError);
      }

      const overlapping = await tx.booking.findFirst({
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

      return tx.booking.create({
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
    });
  }
}
