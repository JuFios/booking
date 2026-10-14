import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, Role } from '../generated/prisma/client';
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

const INVALID_REFRESH_TOKEN = 'Invalid refresh token';

// A token reused this soon after its rotation is treated as a parallel request
// (two tabs, a retry after a timeout), not as theft
export const REUSE_GRACE_PERIOD_MS = 10_000;

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

  // db lets rotate() issue the new pair inside its transaction
  async issue(
    user: { id: string; role: Role },
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<TokensResponseDto> {
    const { id: jti } = await db.refreshToken.create({
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

  async rotate(refreshToken: string): Promise<TokensResponseDto> {
    const { jti } = await this.verifyRefreshToken(refreshToken);
    const now = new Date();

    const tokens = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.refreshToken.updateMany({
        where: { id: jti, revokedAt: null, expiresAt: { gt: now } },
        data: { revokedAt: now },
      });
      if (count === 0) {
        return null;
      }

      const { user } = await tx.refreshToken.findUniqueOrThrow({
        where: { id: jti },
        select: { user: { select: { id: true, role: true } } },
      });
      return this.issue(user, tx);
    });

    if (!tokens) {
      // Outside the transaction: throwing inside it would roll this back
      await this.revokeAllIfReused(jti, now);
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
    }

    return tokens;
  }

  async revoke(refreshToken: string, userId: string): Promise<void> {
    const { jti } = await this.verifyRefreshToken(refreshToken);

    await this.prisma.refreshToken.updateMany({
      where: { id: jti, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async revokeAllIfReused(jti: string, now: Date): Promise<void> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { id: jti },
      select: { userId: true, revokedAt: true },
    });
    if (!stored?.revokedAt) {
      return;
    }

    if (now.getTime() - stored.revokedAt.getTime() < REUSE_GRACE_PERIOD_MS) {
      return;
    }

    await this.prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  private async verifyRefreshToken(
    token: string,
  ): Promise<RefreshTokenPayload> {
    try {
      return await this.jwtService.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
    }
  }
}
