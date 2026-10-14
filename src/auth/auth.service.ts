import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { TokensResponseDto } from './dto/tokens-response.dto';
import { TokensService } from './tokens.service';

// Hash of a random password: checked when the email is unknown, so a login
// for a missing user takes as long as one with a wrong password
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,p=4,t=3$+iQB4IuvSeJudRJnxRnoVQ$EaWdLhQ2H4AyVSodrVlTMH+Pt28FnEGKwareq9HMMvc';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly tokensService: TokensService,
  ) {}

  async register(dto: RegisterDto): Promise<UserResponseDto> {
    const passwordHash = await argon2.hash(dto.password);

    return this.usersService.create({
      email: dto.email,
      name: dto.name,
      passwordHash,
    });
  }

  // Same 401 for an unknown email and a wrong password, so the response
  // does not reveal which emails are registered
  async login(dto: LoginDto): Promise<TokensResponseDto> {
    const user = await this.usersService.findCredentialsByEmail(dto.email);
    const passwordMatches = await argon2.verify(
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
      dto.password,
    );

    if (!user || !passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.tokensService.issue(user);
  }
}
