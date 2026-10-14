import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { Role } from '../generated/prisma/client';
import { CreateEquipmentDto } from './dto/create-equipment.dto';
import {
  EquipmentPageDto,
  EquipmentResponseDto,
} from './dto/equipment-response.dto';
import { EquipmentService } from './equipment.service';

@ApiTags('equipment')
@Controller('equipment')
export class EquipmentController {
  constructor(private readonly equipmentService: EquipmentService) {}

  @Get()
  @ApiOperation({ summary: 'List equipment' })
  @ApiOkResponse({ type: EquipmentPageDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  findAll(@Query() query: PaginationQueryDto): Promise<EquipmentPageDto> {
    return this.equipmentService.findAll(query);
  }

  @Post()
  @Roles(Role.admin)
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Admin role required',
  })
  @ApiOperation({ summary: 'Create equipment' })
  @ApiCreatedResponse({ type: EquipmentResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'Equipment with this name already exists',
  })
  create(@Body() dto: CreateEquipmentDto): Promise<EquipmentResponseDto> {
    return this.equipmentService.create(dto);
  }
}
