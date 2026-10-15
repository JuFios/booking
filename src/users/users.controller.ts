import { Controller, Get, HttpStatus } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { UserResponseDto } from './dto/user-response.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get the current user profile' })
  @ApiOkResponse({ type: UserResponseDto, description: 'The current user' })
  @ApiErrorResponse({
    status: HttpStatus.UNAUTHORIZED,
    path: '/users/me',
    description: 'Missing or invalid access token',
    examples: ['Missing access token', 'Invalid or expired access token'],
  })
  @ApiErrorResponse({
    status: HttpStatus.NOT_FOUND,
    path: '/users/me',
    description: 'The user of the token no longer exists',
    examples: ['User not found'],
  })
  getMe(@CurrentUser() user: AuthenticatedUser): Promise<UserResponseDto> {
    return this.usersService.findById(user.id);
  }
}
