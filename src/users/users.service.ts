import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '../generated/prisma/client';
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

  // A deleted user with a still valid token gets 404 (P2025 in the exception filter)
  findById(id: string): Promise<UserResponseDto> {
    return this.prisma.user.findUniqueOrThrow({
      where: { id },
      select: userSelect,
    });
  }

  findCredentialsByEmail(
    email: string,
  ): Promise<{ id: string; role: Role; passwordHash: string } | null> {
    return this.prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true, passwordHash: true },
    });
  }
}
