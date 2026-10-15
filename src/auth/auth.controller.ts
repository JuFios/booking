import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { TokensResponseDto } from './dto/tokens-response.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new member' })
  @ApiCreatedResponse({
    type: UserResponseDto,
    description: 'The registered user',
  })
  @ApiErrorResponse({
    status: HttpStatus.BAD_REQUEST,
    path: '/auth/register',
    examples: [
      {
        message: 'Validation failed',
        details: [
          'email must be an email',
          'password must be longer than or equal to 8 characters',
        ],
      },
    ],
  })
  @ApiErrorResponse({
    status: HttpStatus.CONFLICT,
    path: '/auth/register',
    description: 'User with this email already exists',
    examples: ['User already exists'],
  })
  register(@Body() dto: RegisterDto): Promise<UserResponseDto> {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in and get access and refresh tokens' })
  @ApiOkResponse({
    type: TokensResponseDto,
    description: 'Access and refresh tokens',
  })
  @ApiErrorResponse({
    status: HttpStatus.BAD_REQUEST,
    path: '/auth/login',
    examples: [
      { message: 'Validation failed', details: ['email must be an email'] },
    ],
  })
  @ApiErrorResponse({
    status: HttpStatus.UNAUTHORIZED,
    path: '/auth/login',
    examples: ['Invalid email or password'],
  })
  login(@Body() dto: LoginDto): Promise<TokensResponseDto> {
    return this.authService.login(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get a new token pair; the used refresh token stops working',
  })
  @ApiOkResponse({ type: TokensResponseDto, description: 'A new token pair' })
  @ApiErrorResponse({
    status: HttpStatus.BAD_REQUEST,
    path: '/auth/refresh',
    examples: [
      {
        message: 'Validation failed',
        details: ['refreshToken must be a jwt string'],
      },
    ],
  })
  @ApiErrorResponse({
    status: HttpStatus.UNAUTHORIZED,
    path: '/auth/refresh',
    description: 'Refresh token is invalid, expired or already used',
    examples: ['Invalid refresh token'],
  })
  refresh(@Body() dto: RefreshTokenDto): Promise<TokensResponseDto> {
    return this.authService.refresh(dto);
  }

  @Post('logout')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a refresh token' })
  @ApiNoContentResponse({ description: 'Refresh token revoked' })
  @ApiErrorResponse({
    status: HttpStatus.BAD_REQUEST,
    path: '/auth/logout',
    examples: [
      {
        message: 'Validation failed',
        details: ['refreshToken must be a jwt string'],
      },
    ],
  })
  @ApiErrorResponse({
    status: HttpStatus.UNAUTHORIZED,
    path: '/auth/logout',
    description: 'Missing or invalid access token',
    examples: ['Missing access token', 'Invalid or expired access token'],
  })
  logout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RefreshTokenDto,
  ): Promise<void> {
    return this.authService.logout(user.id, dto);
  }
}
