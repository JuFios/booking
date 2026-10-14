import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { TokensResponseDto } from './dto/tokens-response.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new member' })
  @ApiCreatedResponse({ type: UserResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'User with this email already exists',
  })
  register(@Body() dto: RegisterDto): Promise<UserResponseDto> {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in and get access and refresh tokens' })
  @ApiOkResponse({ type: TokensResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'Invalid email or password',
  })
  login(@Body() dto: LoginDto): Promise<TokensResponseDto> {
    return this.authService.login(dto);
  }
}
