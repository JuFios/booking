import { Module } from '@nestjs/common';
import { AvailabilityController } from './availability.controller';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

@Module({
  controllers: [BookingsController, AvailabilityController],
  providers: [BookingsService],
})
export class BookingsModule {}
