import { ApiProperty } from '@nestjs/swagger';

export class SeatTypeBreakdownDto {
  @ApiProperty({ description: 'Cantidad de entradas vendidas para esta localidad', example: 10 })
  count: number;

  @ApiProperty({ description: 'Recaudación monetaria total obtenida por esta localidad', example: 150000.00 })
  revenue: number;
}

export class BreakdownBySeatTypeDto {
  @ApiProperty({ type: SeatTypeBreakdownDto, description: 'Desglose para asientos normales' })
  normal: SeatTypeBreakdownDto;

  @ApiProperty({ type: SeatTypeBreakdownDto, description: 'Desglose para asientos VIP' })
  vip: SeatTypeBreakdownDto;
}

export class ShowtimeReportMovieDto {
  @ApiProperty({ example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
  id: string;

  @ApiProperty({ example: 'Inception' })
  title: string;

  @ApiProperty({ example: 148 })
  durationMinutes: number;
}

export class ShowtimeReportRoomDto {
  @ApiProperty({ example: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22' })
  id: string;

  @ApiProperty({ example: 'Sala IMAX 1' })
  name: string;

  @ApiProperty({ example: 80 })
  capacity: number;
}

export class ShowtimeReportResponseDto {
  @ApiProperty({ example: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33' })
  showtimeId: string;

  @ApiProperty({ type: ShowtimeReportMovieDto })
  movie: ShowtimeReportMovieDto;

  @ApiProperty({ type: ShowtimeReportRoomDto })
  room: ShowtimeReportRoomDto;

  @ApiProperty({ example: '2026-10-15T18:00:00.000Z' })
  startTime: Date;

  @ApiProperty({ example: 15000.00 })
  basePrice: number;

  @ApiProperty({ description: 'Capacidad total de la sala', example: 80 })
  totalCapacity: number;

  @ApiProperty({ description: 'Entradas vendidas (VALID y USED)', example: 60 })
  ticketsSold: number;

  @ApiProperty({ description: 'Asientos aún disponibles para venta', example: 20 })
  availableSeats: number;

  @ApiProperty({ description: 'Porcentaje de ocupación respecto a la capacidad de la sala', example: 75.00 })
  occupancyPercentage: number;

  @ApiProperty({ description: 'Recaudación total acumulada de la función', example: 975000.00 })
  totalRevenue: number;

  @ApiProperty({ type: BreakdownBySeatTypeDto, description: 'Desglose discriminado por tipo de asiento (NORMAL vs VIP)' })
  breakdownBySeatType: BreakdownBySeatTypeDto;
}
