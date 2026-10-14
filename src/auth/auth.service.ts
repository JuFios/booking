import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(private readonly usersService: UsersService) {}
  
  async register(dto: RegisterDto): Promise<UserResponseDto> {
    const passwordHash = await argon2.hash(dto.password);

    return this.usersService.create({
      email: dto.email,
      name: dto.name,
      passwordHash,
    });
  }
}
