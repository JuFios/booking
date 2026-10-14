import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { Role } from '../generated/prisma/client';
import { CreateRoomDto } from './dto/create-room.dto';
import { ListRoomsQueryDto } from './dto/list-rooms-query.dto';
import { RoomPageDto, RoomResponseDto } from './dto/room-response.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { RoomsService } from './rooms.service';

@ApiTags('rooms')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'Missing or invalid access token',
})
@ApiBadRequestResponse({ type: ErrorResponseDto })
@Controller('rooms')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Get()
  @ApiOperation({ summary: 'List rooms with filters and pagination' })
  @ApiOkResponse({ type: RoomPageDto })
  findAll(@Query() query: ListRoomsQueryDto): Promise<RoomPageDto> {
    return this.roomsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a room with its equipment' })
  @ApiOkResponse({ type: RoomResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<RoomResponseDto> {
    return this.roomsService.findOne(id);
  }

  @Post()
  @Roles(Role.admin)
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Admin role required',
  })
  @ApiOperation({ summary: 'Create a room' })
  @ApiCreatedResponse({ type: RoomResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'Room with this name already exists',
  })
  create(@Body() dto: CreateRoomDto): Promise<RoomResponseDto> {
    return this.roomsService.create(dto);
  }

  @Patch(':id')
  @Roles(Role.admin)
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Admin role required',
  })
  @ApiOperation({
    summary: 'Update a room, including deactivation (isActive: false)',
  })
  @ApiOkResponse({ type: RoomResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'Room with this name already exists',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoomDto,
  ): Promise<RoomResponseDto> {
    return this.roomsService.update(id, dto);
  }
}
