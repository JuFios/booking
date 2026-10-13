import { Injectable } from '@nestjs/common';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { Page, toPage, toSkipTake } from '../common/utils/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEquipmentDto } from './dto/create-equipment.dto';
import { EquipmentResponseDto } from './dto/equipment-response.dto';

const equipmentSelect = { id: true, name: true, createdAt: true } as const;

@Injectable()
export class EquipmentService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    query: PaginationQueryDto,
  ): Promise<Page<EquipmentResponseDto>> {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.equipment.findMany({
        select: equipmentSelect,
        orderBy: { name: 'asc' },
        ...toSkipTake(query),
      }),
      this.prisma.equipment.count(),
    ]);

    return toPage(items, total, query);
  }

  create(dto: CreateEquipmentDto): Promise<EquipmentResponseDto> {
    return this.prisma.equipment.create({
      data: { name: dto.name },
      select: equipmentSelect,
    });
  }
}
