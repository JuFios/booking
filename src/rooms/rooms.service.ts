import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isEmptyUpdate } from '../common/utils/dto';
import { Page, toPage, toSkipTake } from '../common/utils/pagination';
import { BookingStatus, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { ListRoomsQueryDto } from './dto/list-rooms-query.dto';
import { RoomResponseDto } from './dto/room-response.dto';
import { UpdateRoomDto } from './dto/update-room.dto';

const roomSelect = {
  id: true,
  name: true,
  capacity: true,
  floor: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  equipment: {
    select: { equipment: { select: { id: true, name: true } } },
    orderBy: { equipment: { name: 'asc' } },
  },
} satisfies Prisma.RoomSelect;

type RoomRow = Prisma.RoomGetPayload<{ select: typeof roomSelect }>;

// Also used in the Swagger examples of RoomsController
export const NOTHING_TO_UPDATE =
  'At least one of name, capacity, floor, isActive, equipmentIds is required';

@Injectable()
export class RoomsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListRoomsQueryDto): Promise<Page<RoomResponseDto>> {
    const where = this.buildWhere(query);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.room.findMany({
        where,
        select: roomSelect,
        orderBy: { name: 'asc' },
        ...toSkipTake(query),
      }),
      this.prisma.room.count({ where }),
    ]);

    return toPage(rows.map(toRoomResponse), total, query);
  }

  async findOne(id: string): Promise<RoomResponseDto> {
    const room = await this.prisma.room.findUnique({
      where: { id },
      select: roomSelect,
    });

    if (!room) {
      throw new NotFoundException('Room not found');
    }

    return toRoomResponse(room);
  }

  async create(dto: CreateRoomDto): Promise<RoomResponseDto> {
    const equipmentIds = dto.equipmentIds ?? [];
    await this.assertEquipmentExists(equipmentIds);

    const room = await this.prisma.room.create({
      data: {
        name: dto.name,
        capacity: dto.capacity,
        floor: dto.floor,
        equipment: {
          create: equipmentIds.map((equipmentId) => ({ equipmentId })),
        },
      },
      select: roomSelect,
    });

    return toRoomResponse(room);
  }

  async update(id: string, dto: UpdateRoomDto): Promise<RoomResponseDto> {
    if (isEmptyUpdate(dto)) {
      throw new BadRequestException(NOTHING_TO_UPDATE);
    }

    const { equipmentIds, ...fields } = dto;

    if (equipmentIds) {
      await this.assertEquipmentExists(equipmentIds);
    }

    const room = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Room" WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
      if (locked.length === 0) {
        throw new NotFoundException('Room not found');
      }

      if (fields.capacity !== undefined) {
        await assertCapacityFitsUpcomingBookings(tx, id, fields.capacity);
      }

      return tx.room.update({
        where: { id },
        data: {
          ...fields,
          // the new list replaces the old one
          ...(equipmentIds && {
            equipment: {
              deleteMany: {},
              create: equipmentIds.map((equipmentId) => ({ equipmentId })),
            },
          }),
        },
        select: roomSelect,
      });
    });

    return toRoomResponse(room);
  }

  private buildWhere(query: ListRoomsQueryDto): Prisma.RoomWhereInput {
    return {
      ...(query.minCapacity !== undefined && {
        capacity: { gte: query.minCapacity },
      }),
      ...(query.floor !== undefined && { floor: query.floor }),
      ...(query.isActive !== undefined && { isActive: query.isActive }),
      // the room must have every requested equipment item
      ...(query.equipment?.length && {
        AND: query.equipment.map((equipmentId) => ({
          equipment: { some: { equipmentId } },
        })),
      }),
    };
  }

  private async assertEquipmentExists(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    const found = await this.prisma.equipment.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    const foundIds = new Set(found.map((item) => item.id));
    const unknownIds = ids.filter((id) => !foundIds.has(id));

    if (unknownIds.length > 0) {
      throw new BadRequestException(
        `Unknown equipment ids: ${unknownIds.join(', ')}`,
      );
    }
  }
}

async function assertCapacityFitsUpcomingBookings(
  tx: Prisma.TransactionClient,
  roomId: string,
  capacity: number,
): Promise<void> {
  const { _max } = await tx.booking.aggregate({
    where: {
      roomId,
      status: BookingStatus.confirmed,
      endsAt: { gt: new Date() },
    },
    _max: { attendeesCount: true },
  });

  if (_max.attendeesCount !== null && _max.attendeesCount > capacity) {
    throw new ConflictException(
      `Room has upcoming bookings with ${_max.attendeesCount} attendees`,
    );
  }
}

function toRoomResponse(room: RoomRow): RoomResponseDto {
  return {
    ...room,
    equipment: room.equipment.map((link) => link.equipment),
  };
}
