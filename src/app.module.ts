import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module';
import { BookingsModule } from './bookings/bookings.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import {
  createPinoHttpOptions,
  type LogLevel,
} from './common/logging/logger.config';
import { AppValidationPipe } from './common/pipes/app-validation.pipe';
import { validateEnv } from './config/env.validation';
import { EquipmentModule } from './equipment/equipment.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { RoomsModule } from './rooms/rooms.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      // The request middleware is mounted by useRequestLogging, before the body
      // parser; these options are for the logs made outside a request
      useFactory: (config: ConfigService) => ({
        pinoHttp: createPinoHttpOptions(
          config.getOrThrow<LogLevel>('LOG_LEVEL'),
        ),
        useExisting: true,
      }),
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    HealthModule,
    AuthModule,
    UsersModule,
    EquipmentModule,
    RoomsModule,
    BookingsModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new AppValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}
