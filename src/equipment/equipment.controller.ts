import { Body, Controller, Get, HttpStatus, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { Role } from '../generated/prisma/client';
import { CreateEquipmentDto } from './dto/create-equipment.dto';
import {
  EquipmentPageDto,
  EquipmentResponseDto,
} from './dto/equipment-response.dto';
import { EquipmentService } from './equipment.service';

@ApiTags('equipment')
@ApiBearerAuth()
@ApiErrorResponse({
  status: HttpStatus.UNAUTHORIZED,
  path: '/equipment',
  description: 'Missing or invalid access token',
  examples: ['Missing access token', 'Invalid or expired access token'],
})
@Controller('equipment')
export class EquipmentController {
  constructor(private readonly equipmentService: EquipmentService) {}

  @Get()
  @ApiOperation({ summary: 'List equipment' })
  @ApiOkResponse({ type: EquipmentPageDto, description: 'A page of equipment' })
  @ApiErrorResponse({
    status: HttpStatus.BAD_REQUEST,
    path: '/equipment?limit=101',
    examples: [
      {
        message: 'Validation failed',
        details: ['limit must not be greater than 100'],
      },
    ],
  })
  findAll(@Query() query: PaginationQueryDto): Promise<EquipmentPageDto> {
    return this.equipmentService.findAll(query);
  }

  @Post()
  @Roles(Role.admin)
  @ApiErrorResponse({
    status: HttpStatus.FORBIDDEN,
    path: '/equipment',
    description: 'Admin role required',
    examples: ['Insufficient permissions'],
  })
  @ApiOperation({ summary: 'Create equipment' })
  @ApiCreatedResponse({
    type: EquipmentResponseDto,
    description: 'The created equipment',
  })
  @ApiErrorResponse({
    status: HttpStatus.BAD_REQUEST,
    path: '/equipment',
    examples: [
      { message: 'Validation failed', details: ['name should not be empty'] },
    ],
  })
  @ApiErrorResponse({
    status: HttpStatus.CONFLICT,
    path: '/equipment',
    description: 'Equipment with this name already exists',
    examples: ['Equipment already exists'],
  })
  create(@Body() dto: CreateEquipmentDto): Promise<EquipmentResponseDto> {
    return this.equipmentService.create(dto);
  }
}
