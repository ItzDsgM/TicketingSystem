import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class FilterSummaryReportDto {
  @ApiPropertyOptional({
    description: 'Filtrar por ID de película',
    format: 'uuid',
    example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  })
  @IsOptional()
  @IsUUID('4', { message: 'movieId debe ser un UUID válido versión 4' })
  movieId?: string;

  @ApiPropertyOptional({
    description: 'Filtrar por ID de sala',
    format: 'uuid',
    example: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
  })
  @IsOptional()
  @IsUUID('4', { message: 'roomId debe ser un UUID válido versión 4' })
  roomId?: string;

  @ApiPropertyOptional({
    description: 'Fecha y hora inicial de inicio de funciones (formato ISO 8601)',
    example: '2026-10-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString({}, { message: 'startDate debe ser una fecha ISO 8601 válida' })
  startDate?: string;

  @ApiPropertyOptional({
    description: 'Fecha y hora final de inicio de funciones (formato ISO 8601)',
    example: '2026-10-31T23:59:59.999Z',
  })
  @IsOptional()
  @IsDateString({}, { message: 'endDate debe ser una fecha ISO 8601 válida' })
  endDate?: string;
}
