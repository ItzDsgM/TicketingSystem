import { ApiProperty } from '@nestjs/swagger';
import { BreakdownBySeatTypeDto } from './showtime-report-response.dto';

export class MovieSummaryDto {
  @ApiProperty({ example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
  movieId: string;

  @ApiProperty({ example: 'Inception' })
  title: string;

  @ApiProperty({ description: 'Cantidad de funciones programadas', example: 4 })
  showtimesCount: number;

  @ApiProperty({ description: 'Capacidad total agregada de las salas', example: 320 })
  totalCapacity: number;

  @ApiProperty({ description: 'Cantidad de entradas vendidas para esta película', example: 240 })
  ticketsSold: number;

  @ApiProperty({ description: 'Recaudación total obtenida por esta película', example: 3900000.00 })
  totalRevenue: number;

  @ApiProperty({ description: 'Porcentaje de ocupación promedio para esta película', example: 75.00 })
  occupancyPercentage: number;
}

export class SummaryReportResponseDto {
  @ApiProperty({ description: 'Total de funciones evaluadas en el período', example: 10 })
  totalShowtimes: number;

  @ApiProperty({ description: 'Capacidad total combinada de todas las salas', example: 800 })
  totalCapacity: number;

  @ApiProperty({ description: 'Total de entradas vendidas en todas las funciones', example: 600 })
  totalTicketsSold: number;

  @ApiProperty({ description: 'Total de asientos disponibles aún sin vender', example: 200 })
  totalAvailableSeats: number;

  @ApiProperty({ description: 'Porcentaje global de ocupación de salas', example: 75.00 })
  overallOccupancyPercentage: number;

  @ApiProperty({ description: 'Recaudación monetaria global consolidada', example: 9750000.00 })
  totalRevenue: number;

  @ApiProperty({ type: BreakdownBySeatTypeDto, description: 'Desglose global por tipo de asiento' })
  breakdownBySeatType: BreakdownBySeatTypeDto;

  @ApiProperty({ type: [MovieSummaryDto], description: 'Rendimiento individual por película' })
  movies: MovieSummaryDto[];
}
