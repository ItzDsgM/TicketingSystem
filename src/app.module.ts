import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';

import { buildTypeOrmOptions } from './config/typeorm.config';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { MoviesModule } from './movies/movies.module';
import { RoomsModule } from './rooms/rooms.module';
import { ShowtimesModule } from './showtimes/showtimes.module';
import { SeatHoldsModule } from './seat-holds/seat-holds.module';
import { ReservationsModule } from './reservations/reservations.module';
import { TicketsModule } from './tickets/tickets.module';
import { ReportsModule } from './reports/reports.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: buildTypeOrmOptions,
    }),
    AuthModule,
    UsersModule,
    RolesModule,
    MoviesModule,
    RoomsModule,
    ShowtimesModule,
    SeatHoldsModule,
    ReservationsModule,
    TicketsModule,
    ReportsModule,
    HealthModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
