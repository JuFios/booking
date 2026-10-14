import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TokensResponseDto } from './dto/tokens-response.dto';

export interface AccessTokenPayload {
  sub: string;
  role: Role;
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
}

@Injectable()
export class TokensService {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly accessTtl: number;
  private readonly refreshTtl: number;

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.accessSecret = config.getOrThrow<string>('JWT_ACCESS_SECRET');
    this.refreshSecret = config.getOrThrow<string>('JWT_REFRESH_SECRET');
    this.accessTtl = config.getOrThrow<number>('JWT_ACCESS_TTL');
    this.refreshTtl = config.getOrThrow<number>('JWT_REFRESH_TTL');
  }

  async issue(user: { id: string; role: Role }): Promise<TokensResponseDto> {
    const { id: jti } = await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        expiresAt: new Date(Date.now() + this.refreshTtl * 1000),
      },
      select: { id: true },
    });

    const accessPayload: AccessTokenPayload = { sub: user.id, role: user.role };
    const refreshPayload: RefreshTokenPayload = { sub: user.id, jti };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        secret: this.accessSecret,
        expiresIn: this.accessTtl,
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.refreshSecret,
        expiresIn: this.refreshTtl,
      }),
    ]);

    return { accessToken, refreshToken };
  }
}
