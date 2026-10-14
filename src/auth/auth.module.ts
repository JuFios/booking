import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokensService } from './tokens.service';

@Module({
  // Secrets and lifetimes differ per token type, so they are passed on each sign call
  imports: [UsersModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokensService,
    // Global guard: applies to every route in the app, not only to this module
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AuthModule {}
