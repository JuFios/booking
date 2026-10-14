import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UserResponseDto } from './dto/user-response.dto';

// Fields that are safe to return to clients: passwordHash is never selected
export const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  create(data: {
    email: string;
    name: string;
    passwordHash: string;
  }): Promise<UserResponseDto> {
    return this.prisma.user.create({ data, select: userSelect });
  }
}
