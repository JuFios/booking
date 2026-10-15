import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import {
  getForeignKeyViolation,
  isExclusionViolation,
} from '../common/utils/database-errors';
import { isEmptyUpdate } from '../common/utils/dto';
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

// Prisma's defaults (maxWait 2 s, timeout 5 s) are too short when many bookings
// of one room wait for each other's locks. If even these run out, the global
// filter turns P2028 into 503 instead of 500.
const CANCELLED_BOOKING_CHANGE = 'Cancelled booking cannot be changed';

const BOOKING_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 10_000 };

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
    }, BOOKING_TRANSACTION_OPTIONS);

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
    if (isEmptyUpdate(dto)) {
      throw new BadRequestException(NOTHING_TO_UPDATE);
    }

    const booking = await this.findAccessibleBooking(user, id);
    // Rejects an obviously wrong request before the room lock is taken
    this.assertEditable(booking, new Date());
    if (timeChanged) {
      this.resolveNewTimes(booking, dto, new Date());
    }

    await this.prisma
      .$transaction(async (tx) => {
        if (!timeChanged) {
          return this.updateConfirmed(tx, id, { title: dto.title });
        }

        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${booking.room.id}))`;
        // The booking may have changed while this request waited for the lock:
        // the rules are checked, and the missing field is filled, from its
        // current state, not from the first read
        const current = await tx.booking.findUniqueOrThrow({
          where: { id },
          select: { startsAt: true, endsAt: true, status: true },
        });
        const now = new Date();
        this.assertEditable(current, now);
        const times = this.resolveNewTimes(current, dto, now);
        await this.checkRoomUnderLock(
          tx,
          booking.room.id,
          booking.attendeesCount,
        );

        return this.updateConfirmed(tx, id, { title: dto.title, ...times });
      }, BOOKING_TRANSACTION_OPTIONS)
      .catch((error: unknown) => {
        if (isExclusionViolation(error)) {
          throw new ConflictException(ROOM_ALREADY_BOOKED);
        }
        throw error;
      });

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
        status: true,
        attendeesCount: true,
        user: { select: { id: true } },
        room: { select: { id: true } },
      },
    });

    return this.assertCanAccess(user, booking);
  }

  private assertEditable(
    booking: { endsAt: Date; status: BookingStatus },
    now: Date,
  ): void {
    if (hasEnded(booking, now)) {
      throw new BadRequestException('Ended booking cannot be changed');
    }
    if (booking.status === BookingStatus.cancelled) {
      throw new BadRequestException(CANCELLED_BOOKING_CHANGE);
    }
  }

  // The new times of a PATCH: a field that is not sent keeps its current value
  private resolveNewTimes(
    current: { startsAt: Date; endsAt: Date },
    dto: UpdateBookingDto,
    now: Date,
  ): { startsAt: Date; endsAt: Date } {
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : current.startsAt;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : current.endsAt;

    const timeError = checkBookingTime(startsAt, endsAt, now, current.startsAt);
    if (timeError) {
      throw new BadRequestException(timeError);
    }

    return { startsAt, endsAt };
  }

  // The status filter makes a booking cancelled in the meantime fail here
  private async updateConfirmed(
    tx: Prisma.TransactionClient,
    id: string,
    data: Prisma.BookingUpdateManyMutationInput,
  ): Promise<void> {
    const { count } = await tx.booking.updateMany({
      where: { id, status: BookingStatus.confirmed },
      data,
    });
    if (count === 0) {
      throw new BadRequestException(CANCELLED_BOOKING_CHANGE);
    }
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
      throw error;
    });

    if (inserted.length === 0) {
      throw new ConflictException(ROOM_ALREADY_BOOKED);
    }

    return inserted[0].id;
  }
}
