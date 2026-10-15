import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../generated/prisma/client';
import { CreateRoomDto } from './dto/create-room.dto';
import { ListRoomsQueryDto } from './dto/list-rooms-query.dto';
import { RoomPageDto, RoomResponseDto } from './dto/room-response.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { NOTHING_TO_UPDATE, RoomsService } from './rooms.service';

const ROOM_PATH = '/rooms/8c1f2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';

@ApiTags('rooms')
@ApiBearerAuth()
@ApiErrorResponse({
  status: HttpStatus.UNAUTHORIZED,
  path: '/rooms',
  description: 'Missing or invalid access token',
  examples: ['Missing access token', 'Invalid or expired access token'],
})
@Controller('rooms')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Get()
  @ApiOperation({ summary: 'List rooms with filters and pagination' })
  @ApiOkResponse({ type: RoomPageDto, description: 'A page of rooms' })
  @ApiErrorResponse({
    status: HttpStatus.BAD_REQUEST,
    path: '/rooms?minCapacity=0',
    examples: [
      {
        message: 'Validation failed',
        details: ['minCapacity must not be less than 1'],
      },
    ],
  })
  findAll(@Query() query: ListRoomsQueryDto): Promise<RoomPageDto> {
    return this.roomsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a room with its equipment' })
  @ApiOkResponse({
    type: RoomResponseDto,
    description: 'The room with its equipment',
  })
  @ApiErrorResponse({
    status: HttpStatus.BAD_REQUEST,
    path: '/rooms/abc',
    examples: ['Validation failed (uuid is expected)'],
  })
  @ApiErrorResponse({
    status: HttpStatus.NOT_FOUND,
    path: ROOM_PATH,
    examples: ['Room not found'],
  })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<RoomResponseDto> {
    return this.roomsService.findOne(id);
  }

  @Post()
  @Roles(Role.admin)
  @ApiErrorResponse({
    status: HttpStatus.FORBIDDEN,
    path: '/rooms',
    description: 'Admin role required',
    examples: ['Insufficient permissions'],
  })
  @ApiOperation({ summary: 'Create a room' })
  @ApiCreatedResponse({
    type: RoomResponseDto,
    description: 'The created room',
  })
  @ApiErrorResponse({
    status: HttpStatus.BAD_REQUEST,
    path: '/rooms',
    description: 'Invalid input or unknown equipment',
    examples: [
      {
        message: 'Validation failed',
        details: ['capacity must not be less than 1'],
      },
      'Unknown equipment ids: 3f1c7e2a-8b4d-4c2e-9f6a-1d2e3f4a5b6c',
    ],
  })
  @ApiErrorResponse({
    status: HttpStatus.CONFLICT,
    path: '/rooms',
    description: 'Room with this name already exists',
    examples: ['Room already exists'],
  })
  create(@Body() dto: CreateRoomDto): Promise<RoomResponseDto> {
    return this.roomsService.create(dto);
  }

  @Patch(':id')
  @Roles(Role.admin)
  @ApiErrorResponse({
    status: HttpStatus.FORBIDDEN,
    path: ROOM_PATH,
    description: 'Admin role required',
    examples: ['Insufficient permissions'],
  })
  @ApiOperation({
    summary: 'Update a room, including deactivation (isActive: false)',
  })
  @ApiOkResponse({ type: RoomResponseDto, description: 'The updated room' })
  @ApiErrorResponse({
    status: HttpStatus.BAD_REQUEST,
    path: ROOM_PATH,
    description: 'Invalid input, invalid id or unknown equipment',
    examples: [
      {
        message: 'Validation failed',
        details: ['capacity must not be less than 1'],
      },
      NOTHING_TO_UPDATE,
      'Validation failed (uuid is expected)',
      'Unknown equipment ids: 3f1c7e2a-8b4d-4c2e-9f6a-1d2e3f4a5b6c',
    ],
  })
  @ApiErrorResponse({
    status: HttpStatus.NOT_FOUND,
    path: ROOM_PATH,
    examples: ['Room not found'],
  })
  @ApiErrorResponse({
    status: HttpStatus.CONFLICT,
    path: ROOM_PATH,
    description:
      'Room with this name already exists, or the new capacity is less than the attendees of an upcoming booking',
    examples: [
      'Room already exists',
      'Room has upcoming bookings with 8 attendees',
    ],
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoomDto,
  ): Promise<RoomResponseDto> {
    return this.roomsService.update(id, dto);
  }
}
