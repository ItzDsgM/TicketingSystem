import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

export enum ReservationTimeframe {
  ALL = 'all',
  UPCOMING = 'upcoming',
  PAST = 'past',
}

export class FilterMyReservationsDto {
  @ApiPropertyOptional({
    enum: ReservationTimeframe,
    description:
      'Filtrar por temporalidad de la función: "upcoming" (próximas), "past" (pasadas) o "all" (todas agrupadas)',
    default: ReservationTimeframe.ALL,
  })
  @IsOptional()
  @IsEnum(ReservationTimeframe)
  timeframe?: ReservationTimeframe;
}
