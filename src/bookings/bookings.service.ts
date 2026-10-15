import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Page, toPage, toSkipTake } from '../common/utils/pagination';
import { BookingStatus, Prisma, Role } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  availabilityWindow,
  canAccessBooking,
  checkBookingTime,
  checkRoomForBooking,
  earliestStartEndingAfter,
  findFreeSlots,
  hasEnded,
} from './booking-rules';
import { AvailabilityResponseDto } from './dto/availability-response.dto';
import { BookingResponseDto } from './dto/booking-response.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { ListBookingsQueryDto } from './dto/list-bookings-query.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';

// Also used in the Swagger examples of BookingsController
export const ROOM_ALREADY_BOOKED = 'Room is already booked for this time';
export const NOT_OWNER = 'You can access only your own bookings';
export const NOTHING_TO_UPDATE =
  'At least one of title, startsAt, endsAt is required';

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

    const bookingId = await this.prisma.$transaction(async (tx) => {
      await this.checkRoomUnderLock(tx, dto.roomId, dto.attendeesCount);

      // satisfies checks the object against Prisma's create type: a new required
      // column in Booking stops compiling here and must be added to the raw INSERT
      return this.insertBooking(tx, {
        title: dto.title,
        startsAt,
        endsAt,
        attendeesCount: dto.attendeesCount,
        roomId: dto.roomId,
        userId,
      } satisfies Prisma.BookingUncheckedCreateInput);
    });

    return this.getBooking(bookingId);
  }

  async findAll(
    user: AuthenticatedUser,
    query: ListBookingsQueryDto,
  ): Promise<Page<BookingResponseDto>> {
    const where = this.buildWhere(user, query);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({
        where,
        select: bookingSelect,
        // id makes the order stable when two bookings start at the same time
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        ...toSkipTake(query),
      }),
      this.prisma.booking.count({ where }),
    ]);

    return toPage(rows, total, query);
  }

  async findOne(
    user: AuthenticatedUser,
    id: string,
  ): Promise<BookingResponseDto> {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      select: bookingSelect,
    });

    return this.assertCanAccess(user, booking);
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateBookingDto,
  ): Promise<BookingResponseDto> {
    const timeChanged = dto.startsAt !== undefined || dto.endsAt !== undefined;
    if (dto.title === undefined && !timeChanged) {
      throw new BadRequestException(NOTHING_TO_UPDATE);
    }

    const booking = await this.findAccessibleBooking(user, id);
    const now = new Date();
    if (hasEnded(booking, now)) {
      throw new BadRequestException('Ended booking cannot be changed');
    }

    const startsAt = dto.startsAt ? new Date(dto.startsAt) : booking.startsAt;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : booking.endsAt;

    if (timeChanged) {
      const timeError = checkBookingTime(
        startsAt,
        endsAt,
        now,
        booking.startsAt,
      );
      if (timeError) {
        throw new BadRequestException(timeError);
      }
    }

    const { count } = await this.prisma
      .$transaction(async (tx) => {
        if (timeChanged) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${booking.room.id}))`;
          await this.checkRoomUnderLock(
            tx,
            booking.room.id,
            booking.attendeesCount,
          );
        }

        return tx.booking.updateMany({
          where: { id, status: BookingStatus.confirmed },
          data: { title: dto.title, ...(timeChanged && { startsAt, endsAt }) },
        });
      })
      .catch((error: unknown) => {
        if (isOverlapError(error)) {
          throw new ConflictException(ROOM_ALREADY_BOOKED);
        }
        throw error;
      });
    if (count === 0) {
      throw new BadRequestException('Cancelled booking cannot be changed');
    }

    return this.getBooking(id);
  }

  async cancel(
    user: AuthenticatedUser,
    id: string,
  ): Promise<BookingResponseDto> {
    const booking = await this.findAccessibleBooking(user, id);
    if (hasEnded(booking, new Date())) {
      throw new BadRequestException('Ended booking cannot be cancelled');
    }

    const { count } = await this.prisma.booking.updateMany({
      where: { id, status: BookingStatus.confirmed },
      data: { status: BookingStatus.cancelled },
    });
    if (count === 0) {
      throw new BadRequestException('Booking is already cancelled');
    }

    return this.getBooking(id);
  }

  async getAvailability(
    roomId: string,
    date: string,
  ): Promise<AvailabilityResponseDto> {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: { isActive: true },
    });
    if (!room) {
      throw new NotFoundException('Room not found');
    }

    const window = availabilityWindow(date, new Date());
    if (!room.isActive || !window) {
      return { roomId, date, slots: [] };
    }

    const busy = await this.prisma.booking.findMany({
      where: {
        roomId,
        status: BookingStatus.confirmed,
        startsAt: { gt: earliestStartEndingAfter(window.from), lt: window.to },
        endsAt: { gt: window.from },
      },
      select: { startsAt: true, endsAt: true },
      orderBy: { startsAt: 'asc' },
    });

    return {
      roomId,
      date,
      slots: findFreeSlots(busy, window.from, window.to),
    };
  }

  private async findAccessibleBooking(user: AuthenticatedUser, id: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      select: {
        startsAt: true,
        endsAt: true,
        attendeesCount: true,
        user: { select: { id: true } },
        room: { select: { id: true } },
      },
    });

    return this.assertCanAccess(user, booking);
  }

  private assertCanAccess<T extends { user: { id: string } }>(
    user: AuthenticatedUser,
    booking: T | null,
  ): T {
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    if (!canAccessBooking(user, booking.user.id)) {
      throw new ForbiddenException(NOT_OWNER);
    }

    return booking;
  }

  private async checkRoomUnderLock(
    tx: Prisma.TransactionClient,
    roomId: string,
    attendeesCount: number,
  ): Promise<void> {
    const [room] = await tx.$queryRaw<
      { isActive: boolean; capacity: number }[]
    >`SELECT "isActive", capacity FROM "Room" WHERE id = ${roomId}::uuid FOR SHARE`;
    if (!room) {
      throw new NotFoundException('Room not found');
    }

    const roomError = checkRoomForBooking(room, attendeesCount);
    if (roomError) {
      throw new BadRequestException(roomError);
    }
  }

  private getBooking(id: string): Promise<BookingResponseDto> {
    return this.prisma.booking.findUniqueOrThrow({
      where: { id },
      select: bookingSelect,
    });
  }

  private buildWhere(
    user: AuthenticatedUser,
    query: ListBookingsQueryDto,
  ): Prisma.BookingWhereInput {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (from && to && from >= to) {
      throw new BadRequestException('from must be earlier than to');
    }

    return {
      // a member sees only own bookings, an admin sees all
      ...(user.role !== Role.admin && { userId: user.id }),
      ...(query.roomId && { roomId: query.roomId }),
      ...(query.status && { status: query.status }),
      // the booking overlaps the period [from, to)
      ...(from && { endsAt: { gt: from } }),
      ...((from || to) && {
        startsAt: {
          ...(from && { gt: earliestStartEndingAfter(from) }),
          ...(to && { lt: to }),
        },
      }),
    };
  }

  // INSERT ... ON CONFLICT DO NOTHING instead of prisma.booking.create():
  // a plain INSERT can deadlock when many overlapping bookings are inserted at
  // once, because the exclusion constraint is checked after the row is written.
  // With ON CONFLICT Postgres checks the Booking_no_overlap constraint first and
  // skips the row, so a taken slot returns no rows instead of an error.
  // ON CONSTRAINT limits this to Booking_no_overlap: any other conflict (e.g. a
  // unique constraint added later) stays an error instead of a false 409
  private async insertBooking(
    tx: Prisma.TransactionClient,
    data: {
      title: string;
      startsAt: Date;
      endsAt: Date;
      attendeesCount: number;
      roomId: string;
      userId: string;
    },
  ): Promise<string> {
    const inserted = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO "Booking"
        (id, title, "startsAt", "endsAt", "attendeesCount", "roomId", "userId", "updatedAt")
      VALUES
        (gen_random_uuid(), ${data.title}, ${data.startsAt}, ${data.endsAt},
         ${data.attendeesCount}, ${data.roomId}::uuid, ${data.userId}::uuid, now())
      ON CONFLICT ON CONSTRAINT "Booking_no_overlap" DO NOTHING
      RETURNING id`.catch((error: unknown) => {
      const constraint = getForeignKeyViolation(error);
      if (constraint === 'Booking_userId_fkey') {
        throw new NotFoundException('User not found');
      }
      if (constraint === 'Booking_roomId_fkey') {
        throw new NotFoundException('Room not found');
      }
      throw error;
    });

    if (inserted.length === 0) {
      throw new ConflictException(ROOM_ALREADY_BOOKED);
    }

    return inserted[0].id;
  }
}

interface DatabaseErrorCause {
  originalCode?: string;
  constraint?: { index?: string };
}

function getDatabaseErrorCause(error: unknown): DatabaseErrorCause | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return undefined;
  }

  const meta = error.meta as
    { driverAdapterError?: { cause?: DatabaseErrorCause } } | undefined;
  return meta?.driverAdapterError?.cause;
}

function isOverlapError(error: unknown): boolean {
  return getDatabaseErrorCause(error)?.originalCode === '23P01';
}

function getForeignKeyViolation(error: unknown): string | undefined {
  const cause = getDatabaseErrorCause(error);
  return cause?.originalCode === '23503' ? cause.constraint?.index : undefined;
}
